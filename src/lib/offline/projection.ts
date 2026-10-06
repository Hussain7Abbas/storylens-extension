import {
	latestOpenVersion,
	versionStart,
} from "@/lib/offline/rules/validation";
import type {
	AliasRow,
	AssembledKeyword,
	BiasRow,
	CatalogNovel,
	CategoryRow,
	EntitySyncState,
	KeywordRow,
	LookupsView,
	Mutation,
	NatureRow,
	NovelView,
	ReplacementRow,
	VersionRow,
} from "@/lib/offline/types";

export type NovelSnapshot = {
	novel?: CatalogNovel;
	keywords: KeywordRow[];
	aliases: AliasRow[];
	versions: VersionRow[];
	replacements: ReplacementRow[];
	biases: BiasRow[];
};

export type LookupsSnapshot = {
	categories: CategoryRow[];
	natures: NatureRow[];
};

type Row = Record<string, unknown>;

const iso = (time: number) => new Date(time).toISOString();

/** The account's unresolved mutations in send order; other accounts' never apply. */
export function ownMutations(
	mutations: Mutation[],
	userId: string | null | undefined,
): Mutation[] {
	if (!userId) return [];
	return mutations
		.filter((mutation) => mutation.userId === userId)
		.sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));
}

function stateOf(mutation: Mutation): EntitySyncState {
	if (mutation.status === "conflict") return "conflict";
	if (mutation.status === "rejected") return "rejected";
	return "pending";
}

const STATE_RANK: Record<EntitySyncState, number> = {
	pending: 0,
	missing: 1,
	rejected: 2,
	conflict: 3,
};

function markState(
	states: Map<string, EntitySyncState>,
	id: string,
	state: EntitySyncState,
): void {
	const existing = states.get(id);
	if (!existing || STATE_RANK[state] > STATE_RANK[existing])
		states.set(id, state);
}

function pick(patch: Row, fields: readonly string[]): Row {
	const out: Row = {};
	for (const field of fields) if (field in patch) out[field] = patch[field];
	return out;
}

const KEYWORD_FIELDS = [
	"nameAr",
	"nameEn",
	"matchingType",
	"fuzzyMatchArabicCharacters",
] as const;
const BASE_VERSION_FIELDS = [
	"description",
	"categoryId",
	"natureId",
	"imageId",
] as const;
const ALIAS_FIELDS = [
	"nameAr",
	"nameEn",
	"description",
	"matchingType",
	"fuzzyMatchArabicCharacters",
	"overrideStyle",
	"categoryId",
	"natureId",
	"imageId",
] as const;
const VERSION_FIELDS = [
	"description",
	"categoryId",
	"natureId",
	"imageId",
] as const;
const REPLACEMENT_FIELDS = ["from", "to", "matchingType"] as const;
const LOOKUP_FIELDS = ["nameAr", "nameEn", "color", "description"] as const;

/** Keeps an embedded image while its ID is unchanged; a new or queued image shows once synced. */
function withImage<T extends { imageId: unknown; image: unknown }>(
	row: T,
	changes: Row,
): T {
	if (!("imageId" in changes) || changes.imageId === row.imageId) return row;
	return { ...row, image: null };
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Categories and natures with moderators' pending creates, edits and deletes applied. */
export function projectLookups({
	snapshot,
	mutations,
	userId,
}: {
	snapshot: LookupsSnapshot;
	mutations: Mutation[];
	userId: string | null | undefined;
}): LookupsView {
	const categories = new Map(snapshot.categories.map((row) => [row.id, row]));
	const natures = new Map(snapshot.natures.map((row) => [row.id, row]));
	const states = new Map<string, EntitySyncState>();

	for (const mutation of ownMutations(mutations, userId)) {
		if (
			mutation.entity !== "keywordCategory" &&
			mutation.entity !== "keywordNature"
		)
			continue;
		const table: Map<string, CategoryRow | NatureRow> =
			mutation.entity === "keywordCategory" ? categories : natures;
		const existing = table.get(mutation.entityId);
		const changes = pick(mutation.patch, LOOKUP_FIELDS);
		if (mutation.op === "delete") {
			table.delete(mutation.entityId);
		} else if (mutation.op === "create") {
			table.set(mutation.entityId, {
				nameAr: null,
				nameEn: null,
				description: null,
				color: "#000000",
				createdAt: iso(mutation.createdAt),
				...existing,
				...changes,
				id: mutation.entityId,
				updatedAt: existing?.updatedAt ?? iso(mutation.updatedAt),
			} as CategoryRow);
		} else if (existing) {
			table.set(mutation.entityId, { ...existing, ...changes });
		} else {
			markState(states, mutation.entityId, "missing");
			continue;
		}
		markState(states, mutation.entityId, stateOf(mutation));
	}

	return {
		categories: [...categories.values()],
		natures: [...natures.values()],
		states,
	};
}

// ---------------------------------------------------------------------------
// Novels
// ---------------------------------------------------------------------------

type Working = {
	keywords: Map<string, KeywordRow>;
	aliases: Map<string, AliasRow>;
	versions: Map<string, VersionRow>;
	replacements: Map<string, ReplacementRow>;
	states: Map<string, EntitySyncState>;
};

function removeKeyword(work: Working, keywordId: string): void {
	work.keywords.delete(keywordId);
	for (const [id, alias] of work.aliases)
		if (alias.keywordId === keywordId) work.aliases.delete(id);
	for (const [id, version] of work.versions)
		if (version.keywordId === keywordId) work.versions.delete(id);
	for (const [id, replacement] of work.replacements) {
		if (replacement.keywordId === keywordId) {
			work.replacements.set(id, {
				...replacement,
				keywordId: null,
				keyword: null,
			});
		}
	}
}

function keywordNamed(work: Working, name: string): KeywordRow | undefined {
	return [...work.keywords.values()].find(
		(keyword) => keyword.nameAr === name || keyword.nameEn === name,
	);
}

/** Server chain rewrite: rows whose `to` equals the saved `from` now point to its `to`. */
function rewriteChain(work: Working, saved: ReplacementRow): void {
	const target = keywordNamed(work, saved.to);
	for (const [id, row] of work.replacements) {
		if (
			id !== saved.id &&
			row.novelId === saved.novelId &&
			row.to === saved.from
		) {
			work.replacements.set(id, {
				...row,
				to: saved.to,
				keywordId: target?.id ?? null,
			});
		}
	}
}

const NAME_FIELDS = ["nameAr", "nameEn"] as const;

/**
 * Mirror of the server's `absorb` for a translation link: the target keyword
 * takes the names it lacks, the absorbed keyword's aliases move onto it (an
 * alias that shares a name with one of the target's fills its missing
 * translation instead), its replacements follow, and it goes with its versions.
 */
function absorbKeyword(
	work: Working,
	targetId: string,
	sourceId: string,
): void {
	const source = work.keywords.get(sourceId);
	const target = work.keywords.get(targetId);
	if (!source || !target || source.id === target.id) return;
	work.keywords.set(targetId, {
		...target,
		nameAr: target.nameAr ?? source.nameAr,
		nameEn: target.nameEn ?? source.nameEn,
	});
	for (const alias of [...work.aliases.values()].filter(
		(row) => row.keywordId === sourceId,
	)) {
		const siblings = [...work.aliases.values()].filter(
			(row) => row.keywordId === targetId,
		);
		const taken = {
			nameAr: new Set(
				siblings.flatMap((row) => (row.nameAr ? [row.nameAr] : [])),
			),
			nameEn: new Set(
				siblings.flatMap((row) => (row.nameEn ? [row.nameEn] : [])),
			),
		};
		const free = (field: (typeof NAME_FIELDS)[number]) =>
			alias[field] && !taken[field].has(alias[field] as string)
				? alias[field]
				: null;
		const existing = siblings.find((other) =>
			NAME_FIELDS.some(
				(field) => alias[field] && other[field] === alias[field],
			),
		);
		const compatible =
			existing &&
			NAME_FIELDS.every(
				(field) =>
					!alias[field] || !existing[field] || alias[field] === existing[field],
			);
		if (existing && compatible) {
			work.aliases.set(existing.id, {
				...existing,
				nameAr: existing.nameAr ?? free("nameAr"),
				nameEn: existing.nameEn ?? free("nameEn"),
			});
			work.aliases.delete(alias.id);
			continue;
		}
		const names = { nameAr: free("nameAr"), nameEn: free("nameEn") };
		// An alias whose every name the target already uses goes with its keyword.
		if (!names.nameAr && !names.nameEn) {
			work.aliases.delete(alias.id);
			continue;
		}
		work.aliases.set(alias.id, { ...alias, ...names, keywordId: targetId });
	}
	for (const [id, version] of work.versions)
		if (version.keywordId === sourceId) work.versions.delete(id);
	for (const [id, replacement] of work.replacements) {
		if (replacement.keywordId === sourceId) {
			work.replacements.set(id, {
				...replacement,
				keywordId: targetId,
				keyword: work.keywords.get(targetId) ?? replacement.keyword,
			});
		}
	}
	work.keywords.delete(sourceId);
}

/** Mirror of `mergeTranslationAlias`: the target takes the sibling's missing names. */
function absorbAlias(work: Working, targetId: string, sourceId: string): void {
	const source = work.aliases.get(sourceId);
	const target = work.aliases.get(targetId);
	if (!source || !target || source.id === target.id) return;
	if (source.keywordId !== target.keywordId) return;
	work.aliases.set(targetId, {
		...target,
		nameAr: target.nameAr ?? source.nameAr,
		nameEn: target.nameEn ?? source.nameEn,
	});
	work.aliases.delete(sourceId);
}

/** The translation link a patch carries, when it names a row to absorb. */
function linkOf(patch: Row, field: string): string | undefined {
	const value = patch[field];
	return typeof value === "string" ? value : undefined;
}

function applyKeyword(
	work: Working,
	mutation: Mutation,
	novelId: string,
): boolean {
	const existing = work.keywords.get(mutation.entityId);
	if (mutation.op === "delete") {
		removeKeyword(work, mutation.entityId);
		return true;
	}
	if (mutation.op === "update") {
		if (!existing) return false;
		work.keywords.set(mutation.entityId, {
			...existing,
			...pick(mutation.patch, KEYWORD_FIELDS),
		});
		const linked = linkOf(mutation.patch, "translationKeywordId");
		if (linked) absorbKeyword(work, mutation.entityId, linked);
		return true;
	}
	const createdAt = iso(mutation.createdAt);
	work.keywords.set(mutation.entityId, {
		nameAr: null,
		nameEn: null,
		matchingType: "FULL",
		fuzzyMatchArabicCharacters: true,
		createdAt,
		updatedAt: createdAt,
		...existing,
		...pick(mutation.patch, KEYWORD_FIELDS),
		id: mutation.entityId,
		novelId,
		createdById: existing?.createdById ?? mutation.userId,
	} as KeywordRow);
	// The base version the server creates with the keyword, under the client's `versionId`.
	const versionId = mutation.patch.versionId;
	if (typeof versionId === "string") {
		const version = work.versions.get(versionId);
		work.versions.set(versionId, {
			description: null,
			categoryId: null,
			natureId: null,
			imageId: null,
			image: null,
			category: null,
			nature: null,
			createdAt,
			updatedAt: createdAt,
			...version,
			...pick(mutation.patch, BASE_VERSION_FIELDS),
			id: versionId,
			keywordId: mutation.entityId,
			startingChapter: 0,
			endingChapter: null,
			createdById: version?.createdById ?? mutation.userId,
		} as VersionRow);
		markState(work.states, versionId, stateOf(mutation));
	}
	const linked = linkOf(mutation.patch, "translationKeywordId");
	if (linked) absorbKeyword(work, mutation.entityId, linked);
	return true;
}

function applyAlias(work: Working, mutation: Mutation): boolean {
	const existing = work.aliases.get(mutation.entityId);
	if (mutation.op === "delete") {
		work.aliases.delete(mutation.entityId);
		return true;
	}
	const changes = pick(mutation.patch, ALIAS_FIELDS);
	const linked = linkOf(mutation.patch, "translationAliasId");
	if (mutation.op === "update") {
		if (!existing) return false;
		work.aliases.set(
			mutation.entityId,
			withImage({ ...existing, ...changes }, changes),
		);
		if (linked) absorbAlias(work, mutation.entityId, linked);
		return true;
	}
	const keywordId =
		(mutation.patch.keywordId as string | undefined) ??
		mutation.parentId ??
		existing?.keywordId;
	if (!keywordId || !work.keywords.has(keywordId)) return false;
	const createdAt = iso(mutation.createdAt);
	const base: AliasRow = existing ?? {
		id: mutation.entityId,
		nameAr: null,
		nameEn: null,
		description: null,
		matchingType: "FULL",
		fuzzyMatchArabicCharacters: true,
		overrideStyle: false,
		categoryId: null,
		natureId: null,
		imageId: null,
		keywordId,
		createdById: mutation.userId,
		createdAt,
		updatedAt: createdAt,
		category: null,
		nature: null,
		image: null,
	};
	work.aliases.set(
		mutation.entityId,
		withImage(
			{ ...base, ...changes, id: mutation.entityId, keywordId },
			changes,
		),
	);
	if (linked) absorbAlias(work, mutation.entityId, linked);
	return true;
}

function applyVersion(work: Working, mutation: Mutation): boolean {
	const existing = work.versions.get(mutation.entityId);
	if (mutation.op === "delete") {
		work.versions.delete(mutation.entityId);
		return true;
	}
	const changes = pick(mutation.patch, VERSION_FIELDS);
	if (mutation.op === "update") {
		if (!existing) return false;
		// The server ignores chapter ranges from readers.
		const range = mutation.actor.moderator
			? pick(mutation.patch, ["startingChapter", "endingChapter"])
			: {};
		work.versions.set(
			mutation.entityId,
			withImage({ ...existing, ...changes, ...range }, changes),
		);
		return true;
	}
	const keywordId =
		(mutation.patch.keywordId as string | undefined) ??
		mutation.parentId ??
		existing?.keywordId;
	if (!keywordId || !work.keywords.has(keywordId)) return false;
	const start =
		(existing ? Number(existing.startingChapter) : undefined) ??
		versionStart(
			{
				currentChapter: mutation.patch.currentChapter as number | undefined,
				startingChapter: mutation.patch.startingChapter as number | undefined,
			},
			mutation.actor.moderator,
		) ??
		0;
	if (!existing) {
		// The server closes the latest open version at the new one's start.
		const siblings = [...work.versions.values()].filter(
			(version) => version.keywordId === keywordId,
		);
		const latest = latestOpenVersion(siblings, mutation.entityId);
		if (latest && start > Number(latest.startingChapter)) {
			work.versions.set(latest.id, { ...latest, endingChapter: start - 1 });
		}
	}
	const createdAt = iso(mutation.createdAt);
	const endingChapter = mutation.actor.moderator
		? ((mutation.patch.endingChapter as number | null | undefined) ?? null)
		: null;
	const base: VersionRow = existing ?? {
		id: mutation.entityId,
		description: null,
		startingChapter: start,
		endingChapter,
		categoryId: null,
		natureId: null,
		imageId: null,
		keywordId,
		createdById: mutation.userId,
		createdAt,
		updatedAt: createdAt,
		category: null,
		nature: null,
		image: null,
	};
	work.versions.set(
		mutation.entityId,
		withImage(
			{ ...base, ...changes, id: mutation.entityId, keywordId },
			changes,
		),
	);
	return true;
}

function applyReplacement(
	work: Working,
	mutation: Mutation,
	novelId: string,
): boolean {
	const existing = work.replacements.get(mutation.entityId);
	if (mutation.op === "delete") {
		work.replacements.delete(mutation.entityId);
		return true;
	}
	const changes = pick(mutation.patch, REPLACEMENT_FIELDS);
	if (mutation.op === "update" && !existing) return false;
	const createdAt = iso(mutation.createdAt);
	const merged = {
		matchingType: "FULL",
		createdById: mutation.userId,
		createdAt,
		updatedAt: createdAt,
		keyword: null,
		...existing,
		...changes,
		id: mutation.entityId,
		novelId,
	} as ReplacementRow;
	const saved: ReplacementRow = {
		...merged,
		keywordId: keywordNamed(work, merged.to)?.id ?? null,
	};
	work.replacements.set(saved.id, saved);
	rewriteChain(work, saved);
	return true;
}

function resolveStyle<
	T extends {
		categoryId: unknown;
		natureId: unknown;
		category: unknown;
		nature: unknown;
	},
>(row: T, lookups: LookupsView | undefined): T {
	if (!lookups) return row;
	const category = row.categoryId
		? lookups.categories.find((item) => item.id === row.categoryId)
		: null;
	const nature = row.natureId
		? lookups.natures.find((item) => item.id === row.natureId)
		: null;
	return {
		...row,
		// A lookup missing locally keeps the server's embedded copy.
		category: row.categoryId ? (category ?? row.category) : null,
		nature: row.natureId ? (nature ?? row.nature) : null,
	};
}

const byStart = (left: VersionRow, right: VersionRow) =>
	Number(left.startingChapter) - Number(right.startingChapter);

/**
 * A novel's view: its snapshot with the account's unresolved changes applied in
 * send order, mirroring what the server will do (base versions, cascades,
 * version auto-close, chain rewrites). Pure, so the same inputs always give the
 * same view; embedded categories and natures come from the projected lookups.
 */
export function projectNovel({
	novelId,
	snapshot,
	lookups,
	mutations,
	userId,
}: {
	novelId: string;
	snapshot: NovelSnapshot;
	lookups?: LookupsView;
	mutations: Mutation[];
	userId: string | null | undefined;
}): NovelView {
	const work: Working = {
		keywords: new Map(snapshot.keywords.map((row) => [row.id, row])),
		aliases: new Map(snapshot.aliases.map((row) => [row.id, row])),
		versions: new Map(snapshot.versions.map((row) => [row.id, row])),
		replacements: new Map(snapshot.replacements.map((row) => [row.id, row])),
		states: new Map(),
	};

	for (const mutation of ownMutations(mutations, userId)) {
		if (mutation.novelId !== novelId) continue;
		let applied = false;
		if (mutation.entity === "keyword")
			applied = applyKeyword(work, mutation, novelId);
		else if (mutation.entity === "keywordAlias")
			applied = applyAlias(work, mutation);
		else if (mutation.entity === "keywordVersion")
			applied = applyVersion(work, mutation);
		else if (mutation.entity === "replacement")
			applied = applyReplacement(work, mutation, novelId);
		else continue;
		markState(
			work.states,
			mutation.entityId,
			applied ? stateOf(mutation) : "missing",
		);
	}

	const aliasesByKeyword = new Map<string, AliasRow[]>();
	for (const alias of work.aliases.values()) {
		const list = aliasesByKeyword.get(alias.keywordId) ?? [];
		list.push(resolveStyle(alias, lookups));
		aliasesByKeyword.set(alias.keywordId, list);
	}
	const versionsByKeyword = new Map<string, VersionRow[]>();
	for (const version of work.versions.values()) {
		const list = versionsByKeyword.get(version.keywordId) ?? [];
		list.push(resolveStyle(version, lookups));
		versionsByKeyword.set(version.keywordId, list);
	}

	const keywords: AssembledKeyword[] = [...work.keywords.values()]
		.filter((keyword) => keyword.novelId === novelId)
		.map((keyword) => ({
			...keyword,
			aliases: (aliasesByKeyword.get(keyword.id) ?? []).sort((left, right) =>
				String(left.createdAt).localeCompare(String(right.createdAt)),
			),
			versions: (versionsByKeyword.get(keyword.id) ?? []).sort(byStart),
		}));

	const replacements = [...work.replacements.values()]
		.filter((row) => row.novelId === novelId)
		.map((row) => {
			const keyword = row.keywordId
				? work.keywords.get(row.keywordId)
				: undefined;
			return {
				...row,
				keyword: keyword ?? (row.keywordId ? row.keyword : null),
			} as ReplacementRow;
		});

	return {
		novel: snapshot.novel,
		keywords,
		replacements,
		biases: snapshot.biases,
		states: work.states,
	};
}

/** Every entity ID with a sync state, for badge lookups in lists. */
export function entitySyncStates(view: {
	states: Map<string, EntitySyncState>;
}): Map<string, EntitySyncState> {
	return view.states;
}
