import {
	isOfflineUnavailable,
	offlineDb,
	type StoryLensDatabase,
} from "@/lib/offline/db";
import { listPinned } from "@/lib/offline/meta";
import {
	type NovelSnapshot,
	projectLookups,
	projectNovel,
} from "@/lib/offline/projection";
import type {
	CatalogNovel,
	LookupsView,
	Mutation,
	NovelSync,
	NovelView,
} from "@/lib/offline/types";

/** Reads one novel's snapshot rows; call inside a transaction for a consistent read. */
export async function readNovelSnapshot(
	db: StoryLensDatabase,
	novelId: string,
): Promise<NovelSnapshot> {
	const [novel, keywords, replacements, biases] = await Promise.all([
		db.novels.get(novelId),
		db.keywords.where("novelId").equals(novelId).toArray(),
		db.replacements.where("novelId").equals(novelId).toArray(),
		db.websiteNovelBiases.where("novelId").equals(novelId).toArray(),
	]);
	const keywordIds = keywords.map((keyword) => keyword.id);
	const [aliases, versions] = await Promise.all([
		keywordIds.length
			? db.keywordAliases.where("keywordId").anyOf(keywordIds).toArray()
			: [],
		keywordIds.length
			? db.keywordVersions.where("keywordId").anyOf(keywordIds).toArray()
			: [],
	]);
	return { novel, keywords, aliases, versions, replacements, biases };
}

/** The account's mutations that a novel view or the lookups view applies. */
export async function readUserMutations(
	db: StoryLensDatabase,
	userId: string | null | undefined,
): Promise<Mutation[]> {
	if (!userId) return [];
	return db.mutations.where("userId").equals(userId).toArray();
}

const EMPTY_LOOKUPS: LookupsView = {
	categories: [],
	natures: [],
	states: new Map(),
};

function emptyNovel(): NovelView {
	return {
		novel: undefined,
		keywords: [],
		replacements: [],
		biases: [],
		states: new Map(),
	};
}

/** Categories and natures as the reader sees them (server rows plus pending changes). */
export async function getLookupsView(
	userId: string | null | undefined,
	db: StoryLensDatabase = offlineDb(),
): Promise<LookupsView> {
	if (isOfflineUnavailable()) return EMPTY_LOOKUPS;
	return db.transaction(
		"r",
		[db.keywordCategories, db.keywordNatures, db.mutations],
		async () => {
			const [categories, natures, mutations] = await Promise.all([
				db.keywordCategories.toArray(),
				db.keywordNatures.toArray(),
				readUserMutations(db, userId),
			]);
			return projectLookups({
				snapshot: { categories, natures },
				mutations,
				userId,
			});
		},
	);
}

/**
 * A novel as the UI and page highlighting read it: keywords (with aliases and
 * versions), replacements, chapter biases and a sync state per entity.
 */
export async function getNovelView(
	novelId: string,
	userId: string | null | undefined,
	db: StoryLensDatabase = offlineDb(),
): Promise<NovelView> {
	if (isOfflineUnavailable()) return emptyNovel();
	return db.transaction(
		"r",
		[
			db.novels,
			db.keywords,
			db.keywordAliases,
			db.keywordVersions,
			db.replacements,
			db.websiteNovelBiases,
			db.keywordCategories,
			db.keywordNatures,
			db.mutations,
		],
		async () => {
			const [snapshot, categories, natures, mutations] = await Promise.all([
				readNovelSnapshot(db, novelId),
				db.keywordCategories.toArray(),
				db.keywordNatures.toArray(),
				readUserMutations(db, userId),
			]);
			const lookups = projectLookups({
				snapshot: { categories, natures },
				mutations,
				userId,
			});
			return projectNovel({ novelId, snapshot, lookups, mutations, userId });
		},
	);
}

/** Whether the device holds any server data for the novel yet. */
export async function hasNovelSnapshot(
	novelId: string,
	db: StoryLensDatabase = offlineDb(),
): Promise<boolean> {
	if (isOfflineUnavailable()) return false;
	const sync = await db.novelSync.get(novelId);
	return !!sync?.lastPulledAt;
}

/** The novel catalogue (both languages; readers filter by theirs). Novels are online-only. */
export async function getCatalogueView(
	db: StoryLensDatabase = offlineDb(),
): Promise<CatalogNovel[]> {
	if (isOfflineUnavailable()) return [];
	return db.novels.toArray();
}

export type DownloadedNovel = CatalogNovel & {
	downloadedAt: number;
	removedOnServer?: boolean;
};

/** Downloaded (pinned) novels with their catalogue rows. */
export async function getDownloadedNovels(
	db: StoryLensDatabase = offlineDb(),
): Promise<DownloadedNovel[]> {
	if (isOfflineUnavailable()) return [];
	const pins: NovelSync[] = await listPinned(db);
	const novels = await db.novels.bulkGet(pins.map((pin) => pin.novelId));
	return pins.flatMap((pin, index) => {
		const novel = novels[index];
		return novel
			? [
					{
						...novel,
						downloadedAt: pin.downloadedAt ?? 0,
						removedOnServer: pin.removedOnServer,
					},
				]
			: [];
	});
}

export async function getDownloadedNovelIds(
	db: StoryLensDatabase = offlineDb(),
): Promise<Set<string>> {
	if (isOfflineUnavailable()) return new Set();
	return new Set((await listPinned(db)).map((pin) => pin.novelId));
}
