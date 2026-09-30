import type { EntityTable, IDType, Table } from "dexie";
import { offlineDb, type StoryLensDatabase } from "@/lib/offline/db";
import {
	bumpChangeCounter,
	markRemovedOnServer,
	setMeta,
} from "@/lib/offline/meta";
import type {
	AliasRow,
	AssembledKeyword,
	BiasRow,
	CatalogNovel,
	CategoryRow,
	KeywordRow,
	Mutation,
	NatureRow,
	ReplacementRow,
	SyncEntity,
	VersionRow,
} from "@/lib/offline/types";

/**
 * Snapshot writers. Only pulls and push outcomes call them, inside the sync
 * runner's lock (architecture invariant 2). They never touch local intent in
 * `mutations`, except that a pending update of a row the server removed becomes
 * `conflict(deleted)` in the same transaction, so the reader decides early.
 */

export type NovelBundle = {
	novel: CatalogNovel;
	keywords: (KeywordRow | AssembledKeyword)[];
	aliases?: AliasRow[];
	versions?: VersionRow[];
	replacements: ReplacementRow[];
	biases: BiasRow[];
};

type SnapshotTable =
	| "keywords"
	| "keywordAliases"
	| "keywordVersions"
	| "replacements"
	| "keywordCategories"
	| "keywordNatures"
	| "websiteNovelBiases"
	| "novels";

const ENTITY_TABLE: Partial<Record<SyncEntity, SnapshotTable>> = {
	keyword: "keywords",
	keywordAlias: "keywordAliases",
	keywordVersion: "keywordVersions",
	replacement: "replacements",
	keywordCategory: "keywordCategories",
	keywordNature: "keywordNatures",
};

export function tableOf(entity: SyncEntity): SnapshotTable | undefined {
	return ENTITY_TABLE[entity];
}

/** Splits keyword list rows (with embedded aliases and versions) into the three tables. */
export function splitKeywords(rows: (KeywordRow | AssembledKeyword)[]): {
	keywords: KeywordRow[];
	aliases: AliasRow[];
	versions: VersionRow[];
} {
	const keywords: KeywordRow[] = [];
	const aliases: AliasRow[] = [];
	const versions: VersionRow[] = [];
	for (const row of rows) {
		if ("aliases" in row || "versions" in row) {
			const {
				aliases: children = [],
				versions: ranges = [],
				...keyword
			} = row as AssembledKeyword;
			keywords.push(keyword);
			aliases.push(...children);
			versions.push(...ranges);
		} else {
			keywords.push(row);
		}
	}
	return { keywords, aliases, versions };
}

/** A keyword with its base version's details, kept for "create again" after a remote delete. */
export function withBaseVersion<T extends { id: string }>(
	keyword: T,
	versions: VersionRow[],
): T & { baseVersion?: VersionRow } {
	const baseVersion = versions
		.filter((version) => version.keywordId === keyword.id)
		.sort(
			(left, right) =>
				Number(left.startingChapter) - Number(right.startingChapter),
		)[0];
	return baseVersion ? { ...keyword, baseVersion } : keyword;
}

function time(value: unknown): number {
	const parsed =
		typeof value === "string"
			? Date.parse(value)
			: typeof value === "number"
				? value
				: Number.NaN;
	return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Pending updates of rows the server no longer has become `conflict(deleted)`,
 * keeping the last known row so the reader can discard or create it again.
 */
export async function markDeletedConflicts(
	db: StoryLensDatabase,
	removed: {
		entity: SyncEntity;
		id: string;
		lastKnown?: Record<string, unknown>;
	}[],
): Promise<void> {
	if (!removed.length) return;
	const byId = new Map(removed.map((item) => [item.id, item]));
	const pending = await db.mutations
		.where("entityId")
		.anyOf([...byId.keys()])
		.toArray();
	for (const mutation of pending) {
		const item = byId.get(mutation.entityId);
		if (
			!item ||
			item.entity !== mutation.entity ||
			mutation.op !== "update" ||
			mutation.status !== "pending"
		)
			continue;
		await db.mutations.update(mutation.seq as number, {
			status: "conflict",
			conflict: { kind: "deleted", server: item.lastKnown ?? null },
			updatedAt: Date.now(),
		});
	}
}

function snapshotTables(db: StoryLensDatabase): Table[] {
	return [
		db.novels,
		db.keywords,
		db.keywordAliases,
		db.keywordVersions,
		db.replacements,
		db.websiteNovelBiases,
		db.keywordCategories,
		db.keywordNatures,
		db.mutations,
		db.novelSync,
		db.syncMeta,
	];
}

/** A novel's snapshot rows as stored, keyed by entity. */
async function readNovelRows(db: StoryLensDatabase, novelId: string) {
	const keywords = await db.keywords.where("novelId").equals(novelId).toArray();
	const keywordIds = keywords.map((keyword) => keyword.id);
	const [aliases, versions, replacements, biases] = await Promise.all([
		keywordIds.length
			? db.keywordAliases.where("keywordId").anyOf(keywordIds).toArray()
			: [],
		keywordIds.length
			? db.keywordVersions.where("keywordId").anyOf(keywordIds).toArray()
			: [],
		db.replacements.where("novelId").equals(novelId).toArray(),
		db.websiteNovelBiases.where("novelId").equals(novelId).toArray(),
	]);
	return { keywords, aliases, versions, replacements, biases };
}

/**
 * Replaces one novel's server rows in a single transaction: rows the server
 * deleted disappear locally, and the outbox is left alone (views re-apply it).
 */
export async function replaceNovelSnapshot(
	novelId: string,
	bundle: NovelBundle,
	db: StoryLensDatabase = offlineDb(),
): Promise<void> {
	const split = splitKeywords(bundle.keywords);
	const next = {
		keywords: split.keywords,
		aliases: [...split.aliases, ...(bundle.aliases ?? [])],
		versions: [...split.versions, ...(bundle.versions ?? [])],
		replacements: bundle.replacements,
		biases: bundle.biases,
	};
	await db.transaction("rw", snapshotTables(db), async () => {
		const previous = await readNovelRows(db, novelId);
		const removed: {
			entity: SyncEntity;
			id: string;
			lastKnown: Record<string, unknown>;
		}[] = [];
		const collect = <T extends { id: string }>(
			entity: SyncEntity,
			before: T[],
			after: T[],
		) => {
			const kept = new Set(after.map((row) => row.id));
			for (const row of before)
				if (!kept.has(row.id))
					removed.push({ entity, id: row.id, lastKnown: row });
		};
		collect(
			"keyword",
			previous.keywords.map((keyword) =>
				withBaseVersion(keyword, previous.versions),
			),
			next.keywords,
		);
		collect("keywordAlias", previous.aliases, next.aliases);
		collect("keywordVersion", previous.versions, next.versions);
		collect("replacement", previous.replacements, next.replacements);

		const keywordIds = [
			...new Set(
				[...previous.keywords, ...next.keywords].map((keyword) => keyword.id),
			),
		];
		await db.keywords.where("novelId").equals(novelId).delete();
		if (keywordIds.length) {
			await db.keywordAliases.where("keywordId").anyOf(keywordIds).delete();
			await db.keywordVersions.where("keywordId").anyOf(keywordIds).delete();
		}
		await db.replacements.where("novelId").equals(novelId).delete();
		await db.websiteNovelBiases.where("novelId").equals(novelId).delete();

		await db.novels.put(bundle.novel);
		await db.keywords.bulkPut(next.keywords);
		await db.keywordAliases.bulkPut(next.aliases);
		await db.keywordVersions.bulkPut(next.versions);
		await db.replacements.bulkPut(next.replacements);
		await db.websiteNovelBiases.bulkPut(next.biases);

		await markDeletedConflicts(db, removed);
		await bumpChangeCounter(db, [novelId]);
	});
}

/** Deletes a novel's rows (a removed download); call inside the caller's transaction. */
export async function removeNovelSnapshot(
	db: StoryLensDatabase,
	novelId: string,
): Promise<void> {
	const keywordIds = (await db.keywords
		.where("novelId")
		.equals(novelId)
		.primaryKeys()) as string[];
	if (keywordIds.length) {
		await db.keywordAliases.where("keywordId").anyOf(keywordIds).delete();
		await db.keywordVersions.where("keywordId").anyOf(keywordIds).delete();
	}
	await db.keywords.where("novelId").equals(novelId).delete();
	await db.replacements.where("novelId").equals(novelId).delete();
	await db.websiteNovelBiases.where("novelId").equals(novelId).delete();
}

/** Replaces categories and natures, pruning ones the server deleted. */
export async function replaceLookups(
	lookups: { categories: CategoryRow[]; natures: NatureRow[] },
	db: StoryLensDatabase = offlineDb(),
): Promise<void> {
	await db.transaction("rw", snapshotTables(db), async () => {
		const [categories, natures] = await Promise.all([
			db.keywordCategories.toArray(),
			db.keywordNatures.toArray(),
		]);
		const keptCategories = new Set(lookups.categories.map((row) => row.id));
		const keptNatures = new Set(lookups.natures.map((row) => row.id));
		await db.keywordCategories.clear();
		await db.keywordNatures.clear();
		await db.keywordCategories.bulkPut(lookups.categories);
		await db.keywordNatures.bulkPut(lookups.natures);
		await markDeletedConflicts(db, [
			...categories
				.filter((row) => !keptCategories.has(row.id))
				.map((row) => ({
					entity: "keywordCategory" as const,
					id: row.id,
					lastKnown: row,
				})),
			...natures
				.filter((row) => !keptNatures.has(row.id))
				.map((row) => ({
					entity: "keywordNature" as const,
					id: row.id,
					lastKnown: row,
				})),
		]);
		await setMeta("lookupsPulledAt", Date.now(), db);
		await bumpChangeCounter(db);
	});
}

/**
 * Replaces the novel catalogue, pruning deleted novels. Downloaded novels the
 * server removed stay, marked `removedOnServer`, so the reader can remove them.
 */
export async function replaceCatalogue(
	novels: CatalogNovel[],
	db: StoryLensDatabase = offlineDb(),
): Promise<void> {
	await db.transaction("rw", snapshotTables(db), async () => {
		const pinned = new Set(
			(await db.novelSync.where("pinned").equals(1).toArray()).map(
				(row) => row.novelId,
			),
		);
		const kept = new Set(novels.map((novel) => novel.id));
		const existing = await db.novels.toArray();
		for (const novel of existing) {
			if (kept.has(novel.id)) continue;
			if (pinned.has(novel.id)) await markRemovedOnServer(novel.id, db);
			else await db.novels.delete(novel.id);
		}
		await db.novels.bulkPut(novels);
		await setMeta("catalogPulledAt", Date.now(), db);
		await bumpChangeCounter(db);
	});
}

/**
 * Stores rows from a push response or a delta page. The row with the later
 * `updatedAt` wins, so a late response never overwrites newer server data.
 */
export async function upsertRows<T extends { id: string; updatedAt: unknown }>(
	table: EntityTable<T, "id">,
	rows: T[],
): Promise<void> {
	for (const row of rows) {
		const existing = await table.get(row.id as IDType<T, "id">);
		if (existing && time(existing.updatedAt) > time(row.updatedAt)) continue;
		await table.put(row);
	}
}

/** Removes rows (and a keyword's children); replacements pointing to a removed keyword lose the link. */
export async function removeRows(
	db: StoryLensDatabase,
	entity: SyncEntity,
	ids: string[],
): Promise<void> {
	if (!ids.length) return;
	if (entity === "keyword") {
		await db.keywords.bulkDelete(ids);
		await db.keywordAliases.where("keywordId").anyOf(ids).delete();
		await db.keywordVersions.where("keywordId").anyOf(ids).delete();
		await db.replacements
			.filter((row) => !!row.keywordId && ids.includes(row.keywordId))
			.modify({ keywordId: null, keyword: null });
		return;
	}
	const table = tableOf(entity);
	if (table) await (db[table] as Table<{ id: string }, string>).bulkDelete(ids);
}

type Deleted = { entity: string; id: string };

export type NovelDeltaPage = {
	novel?: CatalogNovel;
	keywords: KeywordRow[];
	aliases: AliasRow[];
	versions: VersionRow[];
	replacements: ReplacementRow[];
	biases: BiasRow[];
	deleted: Deleted[];
	cursor: number;
};

/** Feed entity names that have a snapshot table and can hold pending updates. */
const FEED_ENTITY: Record<string, SyncEntity> = {
	keyword: "keyword",
	keywordAlias: "keywordAlias",
	keywordVersion: "keywordVersion",
	replacement: "replacement",
	keywordCategory: "keywordCategory",
	keywordNature: "keywordNature",
};

async function lastKnownRows(db: StoryLensDatabase, deleted: Deleted[]) {
	const out: {
		entity: SyncEntity;
		id: string;
		lastKnown?: Record<string, unknown>;
	}[] = [];
	for (const item of deleted) {
		const entity = FEED_ENTITY[item.entity];
		const table = entity ? tableOf(entity) : undefined;
		if (!entity || !table) continue;
		const lastKnown = await (
			db[table] as Table<Record<string, unknown>, string>
		).get(item.id);
		out.push({ entity, id: item.id, lastKnown });
	}
	return out;
}

/** Applies one page of a novel's change feed in a single transaction (phase 9). */
export async function applyNovelDelta(
	novelId: string,
	page: NovelDeltaPage,
	db: StoryLensDatabase = offlineDb(),
): Promise<void> {
	await db.transaction("rw", snapshotTables(db), async () => {
		if (page.novel) await upsertRows(db.novels, [page.novel]);
		await upsertRows(db.keywords, page.keywords);
		await upsertRows(db.keywordAliases, page.aliases);
		await upsertRows(db.keywordVersions, page.versions);
		await upsertRows(db.replacements, page.replacements);
		await upsertRows(db.websiteNovelBiases, page.biases);

		const removed = await lastKnownRows(db, page.deleted);
		// A deleted keyword takes its children with it; their updates conflict too.
		const keywordIds = removed
			.filter((item) => item.entity === "keyword")
			.map((item) => item.id);
		if (keywordIds.length) {
			const [aliases, versions] = await Promise.all([
				db.keywordAliases.where("keywordId").anyOf(keywordIds).toArray(),
				db.keywordVersions.where("keywordId").anyOf(keywordIds).toArray(),
			]);
			removed.push(
				...aliases.map((row) => ({
					entity: "keywordAlias" as const,
					id: row.id,
					lastKnown: row,
				})),
				...versions.map((row) => ({
					entity: "keywordVersion" as const,
					id: row.id,
					lastKnown: row,
				})),
			);
		}
		await markDeletedConflicts(db, removed);
		for (const entity of [
			"keyword",
			"keywordAlias",
			"keywordVersion",
			"replacement",
		] as const) {
			await removeRows(
				db,
				entity,
				page.deleted
					.filter((item) => item.entity === entity)
					.map((item) => item.id),
			);
		}
		const biasIds = page.deleted
			.filter((item) => item.entity === "websiteNovelBias")
			.map((item) => item.id);
		if (biasIds.length) await db.websiteNovelBiases.bulkDelete(biasIds);
		if (
			page.deleted.some(
				(item) => item.entity === "novel" && item.id === novelId,
			)
		) {
			await markRemovedOnServer(novelId, db);
			await markNovelMutationsDeleted(db, novelId);
		}
		const existing = await db.novelSync.get(novelId);
		await db.novelSync.put({
			novelId,
			pinned: 0,
			...existing,
			cursor: page.cursor,
			lastPulledAt: Date.now(),
			lastPullError: undefined,
			refreshRequestedAt: undefined,
			pullDue: undefined,
		});
		await bumpChangeCounter(db, [novelId]);
	});
}

/** A novel removed on the server: its pending updates can no longer apply. */
export async function markNovelMutationsDeleted(
	db: StoryLensDatabase,
	novelId: string,
): Promise<void> {
	const mutations = await db.mutations
		.where("novelId")
		.equals(novelId)
		.toArray();
	for (const mutation of mutations as Mutation[]) {
		if (mutation.status !== "pending" || mutation.op === "delete") continue;
		await db.mutations.update(mutation.seq as number, {
			status: "conflict",
			conflict: {
				kind: mutation.op === "create" ? "parent-missing" : "deleted",
				server: null,
			},
			updatedAt: Date.now(),
		});
	}
}

/** Applies one page of the lookups feed (phase 9). */
export async function applyLookupsDelta(
	page: {
		categories: CategoryRow[];
		natures: NatureRow[];
		deleted: Deleted[];
		cursor: number;
	},
	db: StoryLensDatabase = offlineDb(),
): Promise<void> {
	await db.transaction("rw", snapshotTables(db), async () => {
		await upsertRows(db.keywordCategories, page.categories);
		await upsertRows(db.keywordNatures, page.natures);
		await markDeletedConflicts(db, await lastKnownRows(db, page.deleted));
		await removeRows(
			db,
			"keywordCategory",
			page.deleted
				.filter((item) => item.entity === "keywordCategory")
				.map((item) => item.id),
		);
		await removeRows(
			db,
			"keywordNature",
			page.deleted
				.filter((item) => item.entity === "keywordNature")
				.map((item) => item.id),
		);
		await setMeta("lookupsCursor", page.cursor, db);
		await setMeta("lookupsPulledAt", Date.now(), db);
		await bumpChangeCounter(db);
	});
}

/** Applies one page of the catalogue feed (phase 9). */
export async function applyCatalogueDelta(
	page: { novels: CatalogNovel[]; deleted: Deleted[]; cursor: number },
	db: StoryLensDatabase = offlineDb(),
): Promise<void> {
	await db.transaction("rw", snapshotTables(db), async () => {
		await upsertRows(db.novels, page.novels);
		const pinned = new Set(
			(await db.novelSync.where("pinned").equals(1).toArray()).map(
				(row) => row.novelId,
			),
		);
		for (const item of page.deleted) {
			if (item.entity !== "novel") continue;
			if (pinned.has(item.id)) {
				await markRemovedOnServer(item.id, db);
				await markNovelMutationsDeleted(db, item.id);
			} else await db.novels.delete(item.id);
		}
		await setMeta("catalogueCursor", page.cursor, db);
		await setMeta("catalogPulledAt", Date.now(), db);
		await bumpChangeCounter(db);
	});
}
