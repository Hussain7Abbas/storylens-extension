import Dexie, { type EntityTable } from "dexie";
import type {
	GetKeywords200DataItem,
	GetNovels200DataItem,
} from "@/api/generated/schemas";
import {
	getDownloadedNovelIds,
	getPendingDeletedEntityIds,
} from "@/lib/offline/sync-storage";
import type {
	CatalogNovel,
	DownloadedNovel,
	OfflineKeyword,
	OfflineKeywordAlias,
	OfflineKeywordCategory,
	OfflineKeywordNature,
	OfflineKeywordVersion,
	OfflineReplacement,
	OfflineWebsiteNovelBias,
} from "@/lib/offline/types";
import {
	cleanOfflineKeyword,
	cleanOfflineKeywordAlias,
	cleanOfflineKeywordVersion,
	cleanOfflineReplacement,
} from "@/lib/offline/types";

class StoryLensOfflineDatabase extends Dexie {
	catalogNovels!: EntityTable<CatalogNovel, "id">;
	novels!: EntityTable<DownloadedNovel, "id">;
	keywords!: EntityTable<OfflineKeyword, "id">;
	keywordAliases!: EntityTable<OfflineKeywordAlias, "id">;
	keywordVersions!: EntityTable<OfflineKeywordVersion, "id">;
	replacements!: EntityTable<OfflineReplacement, "id">;
	keywordCategories!: EntityTable<OfflineKeywordCategory, "id">;
	keywordNatures!: EntityTable<OfflineKeywordNature, "id">;
	websiteNovelBiases!: EntityTable<OfflineWebsiteNovelBias, "id">;

	constructor() {
		super("storylens-offline");

		this.version(1).stores({
			novels: "id, name, downloadedAt",
			keywords: "id, novelId, name, categoryId, natureId",
			replacements: "id, novelId, from",
			keywordCategories: "id, name",
			keywordNatures: "id, name",
		});

		this.version(2).stores({
			catalogNovels: "id, name",
			novels: "id, name, downloadedAt",
			keywords: "id, novelId, name, categoryId, natureId",
			replacements: "id, novelId, from",
			keywordCategories: "id, name",
			keywordNatures: "id, name",
		});

		this.version(3)
			.stores({
				catalogNovels: "id, name",
				novels: "id, name, downloadedAt",
				keywords: "id, novelId, name, categoryId, natureId",
				replacements: "id, novelId, from",
				keywordCategories: "id, name",
				keywordNatures: "id, name",
			})
			.upgrade(async (transaction) => {
				await transaction
					.table("keywords")
					.toCollection()
					.modify((keyword: OfflineKeyword) => {
						if (!keyword.matchingType) {
							keyword.matchingType = "FULL";
						}
					});

				await transaction
					.table("replacements")
					.toCollection()
					.modify((replacement: OfflineReplacement) => {
						if (!replacement.matchingType) {
							replacement.matchingType = "FULL";
						}
					});
			});

		this.version(4).stores({
			catalogNovels: "id, name",
			novels: "id, name, downloadedAt",
			keywords: "id, novelId, name, categoryId, natureId, parentId",
			replacements: "id, novelId, from",
			keywordCategories: "id, name",
			keywordNatures: "id, name",
		});

		this.version(5).stores({
			catalogNovels: "id, name",
			novels: "id, name, downloadedAt",
			keywords: "id, novelId, name, categoryId, natureId, parentId",
			replacements: "id, novelId, from",
			keywordCategories: "id, name",
			keywordNatures: "id, name",
			websiteNovelBiases:
				"id, novelId, websiteSelectorId, [novelId+websiteSelectorId]",
		});

		this.version(6).stores({
			catalogNovels: "id, name",
			novels: "id, name, downloadedAt",
			keywords:
				"id, novelId, name, categoryId, natureId, parentId, type, [parentId+type], [parentId+startingChapter]",
			replacements: "id, novelId, from",
			keywordCategories: "id, name",
			keywordNatures: "id, name",
			websiteNovelBiases:
				"id, novelId, websiteSelectorId, [novelId+websiteSelectorId]",
		});

		// v7: split keywords into three dedicated tables
		this.version(7)
			.stores({
				catalogNovels: "id, name",
				novels: "id, name, downloadedAt",
				keywords: "id, novelId, name",
				keywordAliases: "id, keywordId, [keywordId+name]",
				keywordVersions: "id, keywordId, [keywordId+startingChapter]",
				replacements: "id, novelId, from",
				keywordCategories: "id, name",
				keywordNatures: "id, name",
				websiteNovelBiases:
					"id, novelId, websiteSelectorId, [novelId+websiteSelectorId]",
			})
			.upgrade(async (transaction) => {
				// Clear old keyword cache — it used the old single-table format.
				// Fresh data will be fetched from the API on next access.
				await transaction.table("keywords").clear();
			});
	}
}

export const offlineDb = new StoryLensOfflineDatabase();

export async function getDownloadedNovel(
	novelId: string,
): Promise<DownloadedNovel | undefined> {
	return offlineDb.novels.get(novelId);
}

export async function isNovelDownloaded(novelId: string): Promise<boolean> {
	const ids = await getDownloadedNovelIds();
	return ids.includes(novelId);
}

export async function getAllCatalogNovels(): Promise<CatalogNovel[]> {
	return offlineDb.catalogNovels.orderBy("name").toArray();
}

export async function bulkPutCatalogNovels(
	novels: GetNovels200DataItem[],
): Promise<void> {
	await offlineDb.catalogNovels.bulkPut(novels);
}

export async function saveCatalogNovel(novel: CatalogNovel): Promise<void> {
	await offlineDb.catalogNovels.put(novel);
}

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

export async function getKeywordsByNovelId(
	novelId: string,
): Promise<OfflineKeyword[]> {
	return offlineDb.keywords.where("novelId").equals(novelId).toArray();
}

export async function getAliasesByKeywordId(
	keywordId: string,
): Promise<OfflineKeywordAlias[]> {
	return offlineDb.keywordAliases
		.where("keywordId")
		.equals(keywordId)
		.toArray();
}

export async function getVersionsByKeywordId(
	keywordId: string,
): Promise<OfflineKeywordVersion[]> {
	return offlineDb.keywordVersions
		.where("keywordId")
		.equals(keywordId)
		.toArray();
}

export async function getKeywordById(
	id: string,
): Promise<OfflineKeyword | undefined> {
	return offlineDb.keywords.get(id);
}

export async function getKeywordAliasById(
	id: string,
): Promise<OfflineKeywordAlias | undefined> {
	return offlineDb.keywordAliases.get(id);
}

export async function getKeywordVersionById(
	id: string,
): Promise<OfflineKeywordVersion | undefined> {
	return offlineDb.keywordVersions.get(id);
}

/**
 * Returns root keywords assembled with their aliases and versions, matching
 * the shape expected by enrichKeywords().
 */
export async function getAssembledKeywordsByNovelId(
	novelId: string,
): Promise<GetKeywords200DataItem[]> {
	const roots = await getKeywordsByNovelId(novelId);
	if (roots.length === 0) return [];

	const keywordIds = roots.map((k) => k.id);

	const [allAliases, allVersions] = await Promise.all([
		offlineDb.keywordAliases.where("keywordId").anyOf(keywordIds).toArray(),
		offlineDb.keywordVersions.where("keywordId").anyOf(keywordIds).toArray(),
	]);

	const aliasesByKeyword = new Map<string, OfflineKeywordAlias[]>();
	for (const alias of allAliases) {
		const list = aliasesByKeyword.get(alias.keywordId) ?? [];
		list.push(alias);
		aliasesByKeyword.set(alias.keywordId, list);
	}

	const versionsByKeyword = new Map<string, OfflineKeywordVersion[]>();
	for (const version of allVersions) {
		const list = versionsByKeyword.get(version.keywordId) ?? [];
		list.push(version);
		versionsByKeyword.set(version.keywordId, list);
	}

	return roots.map((kw) => ({
		...kw,
		aliases: aliasesByKeyword.get(kw.id) ?? [],
		versions: (versionsByKeyword.get(kw.id) ?? []).sort(
			(a, b) => Number(a.startingChapter) - Number(b.startingChapter),
		),
	}));
}

export async function getReplacementsByNovelId(
	novelId: string,
): Promise<OfflineReplacement[]> {
	return offlineDb.replacements.where("novelId").equals(novelId).toArray();
}

export async function getAllKeywordCategories(): Promise<
	OfflineKeywordCategory[]
> {
	return offlineDb.keywordCategories.toArray();
}

export async function getAllKeywordNatures(): Promise<OfflineKeywordNature[]> {
	return offlineDb.keywordNatures.toArray();
}

export async function getDownloadedNovels(): Promise<DownloadedNovel[]> {
	const ids = await getDownloadedNovelIds();
	if (ids.length === 0) return [];
	return offlineDb.novels.where("id").anyOf(ids).sortBy("name");
}

export async function getOfflineNovelBySlug(
	slug: string,
): Promise<DownloadedNovel | undefined> {
	const downloadedIds = await getDownloadedNovelIds();
	if (downloadedIds.length === 0) return undefined;

	const normalized = slug.trim().toLowerCase();
	const novels = await offlineDb.novels
		.where("id")
		.anyOf(downloadedIds)
		.toArray();
	return novels.find((novel) =>
		novel.slugs.some((entry) => entry.trim().toLowerCase() === normalized),
	);
}

export async function getCatalogNovelBySlug(
	slug: string,
): Promise<CatalogNovel | undefined> {
	const normalized = slug.trim().toLowerCase();
	const novels = await offlineDb.catalogNovels.toArray();
	return novels.find((novel) =>
		novel.slugs.some((entry) => entry.trim().toLowerCase() === normalized),
	);
}

export async function getCatalogNovelById(
	novelId: string,
): Promise<CatalogNovel | undefined> {
	return offlineDb.catalogNovels.get(novelId);
}

// ---------------------------------------------------------------------------
// Novel content cache (keywords + aliases + versions)
// ---------------------------------------------------------------------------

async function replaceKeywordsForNovel(
	novelId: string,
	serverKeywords: GetKeywords200DataItem[],
): Promise<void> {
	const existing = await getKeywordsByNovelId(novelId);
	const dirtyKeywords = existing.filter((k) => k.isDirty);
	const dirtyIds = new Set(dirtyKeywords.map((k) => k.id));
	const pendingDeletes = await getPendingDeletedEntityIds(novelId, "keyword");

	const cleanRoots = serverKeywords
		.filter((k) => !dirtyIds.has(k.id) && !pendingDeletes.has(k.id))
		.map((k) => cleanOfflineKeyword({ ...k, aliases: [], versions: [] }));

	const cleanAliases = serverKeywords
		.flatMap((k) => k.aliases)
		.filter((a) => !pendingDeletes.has(a.id))
		.map(cleanOfflineKeywordAlias);

	const cleanVersions = serverKeywords
		.flatMap((k) => k.versions)
		.filter((v) => !pendingDeletes.has(v.id))
		.map(cleanOfflineKeywordVersion);

	await offlineDb.transaction(
		"rw",
		[offlineDb.keywords, offlineDb.keywordAliases, offlineDb.keywordVersions],
		async () => {
			await offlineDb.keywords.where("novelId").equals(novelId).delete();
			const rootIds = serverKeywords.map((k) => k.id);
			if (rootIds.length > 0) {
				await offlineDb.keywordAliases
					.where("keywordId")
					.anyOf(rootIds)
					.delete();
				await offlineDb.keywordVersions
					.where("keywordId")
					.anyOf(rootIds)
					.delete();
			}

			const merged: OfflineKeyword[] = [...cleanRoots, ...dirtyKeywords];
			if (merged.length > 0) await offlineDb.keywords.bulkPut(merged);
			if (cleanAliases.length > 0)
				await offlineDb.keywordAliases.bulkPut(cleanAliases);
			if (cleanVersions.length > 0)
				await offlineDb.keywordVersions.bulkPut(cleanVersions);
		},
	);
}

async function replaceReplacementsForNovel(
	novelId: string,
	serverReplacements: OfflineReplacement[],
): Promise<void> {
	const existing = await getReplacementsByNovelId(novelId);
	const dirtyReplacements = existing.filter((r) => r.isDirty);
	const dirtyIds = new Set(dirtyReplacements.map((r) => r.id));
	const pendingDeletes = await getPendingDeletedEntityIds(
		novelId,
		"replacement",
	);

	const merged = [
		...serverReplacements
			.filter((r) => !dirtyIds.has(r.id) && !pendingDeletes.has(r.id))
			.map(cleanOfflineReplacement),
		...dirtyReplacements,
	];

	await offlineDb.transaction("rw", offlineDb.replacements, async () => {
		await offlineDb.replacements.where("novelId").equals(novelId).delete();
		if (merged.length > 0) await offlineDb.replacements.bulkPut(merged);
	});
}

export async function getBiasesByNovelId(
	novelId: string,
): Promise<OfflineWebsiteNovelBias[]> {
	return offlineDb.websiteNovelBiases
		.where("novelId")
		.equals(novelId)
		.toArray();
}

export async function replaceBiasesForNovel(
	novelId: string,
	serverBiases: OfflineWebsiteNovelBias[],
): Promise<void> {
	await offlineDb.transaction("rw", offlineDb.websiteNovelBiases, async () => {
		await offlineDb.websiteNovelBiases
			.where("novelId")
			.equals(novelId)
			.delete();
		if (serverBiases.length > 0)
			await offlineDb.websiteNovelBiases.bulkPut(serverBiases);
	});
}

export async function writeNovelContentCache(
	novel: CatalogNovel,
	keywords: GetKeywords200DataItem[],
	replacements: OfflineReplacement[],
	biases: OfflineWebsiteNovelBias[] = [],
): Promise<void> {
	const downloaded = await isNovelDownloaded(novel.id);
	await saveCatalogNovel(novel);
	if (downloaded) return;

	await replaceKeywordsForNovel(novel.id, keywords);
	await replaceReplacementsForNovel(novel.id, replacements);
	await replaceBiasesForNovel(novel.id, biases);
}

// ---------------------------------------------------------------------------
// Individual keyword / alias / version mutations
// ---------------------------------------------------------------------------

export async function saveKeyword(keyword: OfflineKeyword): Promise<void> {
	await offlineDb.keywords.put(keyword);
}

export async function saveKeywordAlias(
	alias: OfflineKeywordAlias,
): Promise<void> {
	await offlineDb.keywordAliases.put(alias);
}

export async function saveKeywordVersion(
	version: OfflineKeywordVersion,
): Promise<void> {
	await offlineDb.keywordVersions.put(version);
}

export async function markKeywordDirty(id: string): Promise<void> {
	const keyword = await offlineDb.keywords.get(id);
	if (!keyword) return;
	await offlineDb.keywords.put({ ...keyword, isDirty: true });
}

export async function markKeywordAliasDirty(id: string): Promise<void> {
	const alias = await offlineDb.keywordAliases.get(id);
	if (!alias) return;
	await offlineDb.keywordAliases.put({ ...alias, isDirty: true });
}

export async function markKeywordVersionDirty(id: string): Promise<void> {
	const version = await offlineDb.keywordVersions.get(id);
	if (!version) return;
	await offlineDb.keywordVersions.put({ ...version, isDirty: true });
}

export async function clearKeywordDirty(id: string): Promise<void> {
	const keyword = await offlineDb.keywords.get(id);
	if (!keyword?.isDirty) return;
	await offlineDb.keywords.put(cleanOfflineKeyword(keyword));
}

export async function clearKeywordAliasDirty(id: string): Promise<void> {
	const alias = await offlineDb.keywordAliases.get(id);
	if (!alias?.isDirty) return;
	await offlineDb.keywordAliases.put(cleanOfflineKeywordAlias(alias));
}

export async function clearKeywordVersionDirty(id: string): Promise<void> {
	const version = await offlineDb.keywordVersions.get(id);
	if (!version?.isDirty) return;
	await offlineDb.keywordVersions.put(cleanOfflineKeywordVersion(version));
}

export async function saveReplacement(
	replacement: OfflineReplacement,
): Promise<void> {
	await offlineDb.replacements.put(replacement);
}

export async function markReplacementDirty(id: string): Promise<void> {
	const replacement = await offlineDb.replacements.get(id);
	if (!replacement) return;
	await offlineDb.replacements.put({ ...replacement, isDirty: true });
}

export async function clearReplacementDirty(id: string): Promise<void> {
	const replacement = await offlineDb.replacements.get(id);
	if (!replacement?.isDirty) return;
	await offlineDb.replacements.put(cleanOfflineReplacement(replacement));
}

export async function deleteKeywordById(id: string): Promise<void> {
	await offlineDb.transaction(
		"rw",
		[offlineDb.keywords, offlineDb.keywordAliases, offlineDb.keywordVersions],
		async () => {
			await offlineDb.keywordAliases.where("keywordId").equals(id).delete();
			await offlineDb.keywordVersions.where("keywordId").equals(id).delete();
			await offlineDb.keywords.delete(id);
		},
	);
}

export async function deleteKeywordAliasById(id: string): Promise<void> {
	await offlineDb.keywordAliases.delete(id);
}

export async function deleteKeywordVersionById(id: string): Promise<void> {
	await offlineDb.keywordVersions.delete(id);
}

export async function deleteReplacementById(id: string): Promise<void> {
	await offlineDb.replacements.delete(id);
}

export async function saveKeywordCategory(
	category: OfflineKeywordCategory,
): Promise<void> {
	await offlineDb.keywordCategories.put(category);
}

export async function saveKeywordNature(
	nature: OfflineKeywordNature,
): Promise<void> {
	await offlineDb.keywordNatures.put(nature);
}

export async function deleteKeywordCategoryById(id: string): Promise<void> {
	await offlineDb.keywordCategories.delete(id);
}

export async function deleteKeywordNatureById(id: string): Promise<void> {
	await offlineDb.keywordNatures.delete(id);
}

export async function bulkPutKeywordCategories(
	categories: OfflineKeywordCategory[],
): Promise<void> {
	await offlineDb.keywordCategories.bulkPut(categories);
}

export async function bulkPutKeywordNatures(
	natures: OfflineKeywordNature[],
): Promise<void> {
	await offlineDb.keywordNatures.bulkPut(natures);
}

export async function replaceKeywordCategoryId(
	tempId: string,
	serverId: string,
): Promise<void> {
	const category = await offlineDb.keywordCategories.get(tempId);
	if (!category) return;

	const serverCategory = { ...category, id: serverId };
	const versions = await offlineDb.keywordVersions
		.filter((v) => v.categoryId === tempId)
		.toArray();

	await offlineDb.transaction(
		"rw",
		[offlineDb.keywordCategories, offlineDb.keywordVersions],
		async () => {
			await offlineDb.keywordCategories.delete(tempId);
			await offlineDb.keywordCategories.put(serverCategory);
			await offlineDb.keywordVersions.bulkPut(
				versions.map((v) => ({
					...v,
					categoryId: serverId,
					category: serverCategory,
				})),
			);
		},
	);
}

export async function replaceKeywordNatureId(
	tempId: string,
	serverId: string,
): Promise<void> {
	const nature = await offlineDb.keywordNatures.get(tempId);
	if (!nature) return;

	const serverNature = { ...nature, id: serverId };
	const versions = await offlineDb.keywordVersions
		.filter((v) => v.natureId === tempId)
		.toArray();

	await offlineDb.transaction(
		"rw",
		[offlineDb.keywordNatures, offlineDb.keywordVersions],
		async () => {
			await offlineDb.keywordNatures.delete(tempId);
			await offlineDb.keywordNatures.put(serverNature);
			await offlineDb.keywordVersions.bulkPut(
				versions.map((v) => ({
					...v,
					natureId: serverId,
					nature: serverNature,
				})),
			);
		},
	);
}

export async function updateKeywordCategoryReferences(
	category: OfflineKeywordCategory,
): Promise<void> {
	const versions = await offlineDb.keywordVersions
		.filter((v) => v.categoryId === category.id)
		.toArray();
	await offlineDb.keywordVersions.bulkPut(
		versions.map((v) => ({ ...v, category })),
	);
}

export async function updateKeywordNatureReferences(
	nature: OfflineKeywordNature,
): Promise<void> {
	const versions = await offlineDb.keywordVersions
		.filter((v) => v.natureId === nature.id)
		.toArray();
	await offlineDb.keywordVersions.bulkPut(
		versions.map((v) => ({ ...v, nature })),
	);
}

export async function replaceKeywordId(
	tempId: string,
	serverId: string,
): Promise<void> {
	const keyword = await offlineDb.keywords.get(tempId);
	if (!keyword) return;

	const aliases = await offlineDb.keywordAliases
		.where("keywordId")
		.equals(tempId)
		.toArray();
	const versions = await offlineDb.keywordVersions
		.where("keywordId")
		.equals(tempId)
		.toArray();

	await offlineDb.transaction(
		"rw",
		[offlineDb.keywords, offlineDb.keywordAliases, offlineDb.keywordVersions],
		async () => {
			await offlineDb.keywords.delete(tempId);
			await offlineDb.keywords.put(
				cleanOfflineKeyword({ ...keyword, id: serverId }),
			);
			if (aliases.length > 0) {
				await offlineDb.keywordAliases
					.where("keywordId")
					.equals(tempId)
					.delete();
				await offlineDb.keywordAliases.bulkPut(
					aliases.map((a) =>
						cleanOfflineKeywordAlias({ ...a, keywordId: serverId }),
					),
				);
			}
			if (versions.length > 0) {
				await offlineDb.keywordVersions
					.where("keywordId")
					.equals(tempId)
					.delete();
				await offlineDb.keywordVersions.bulkPut(
					versions.map((v) =>
						cleanOfflineKeywordVersion({ ...v, keywordId: serverId }),
					),
				);
			}
		},
	);
}

export async function replaceKeywordAliasId(
	tempId: string,
	serverId: string,
): Promise<void> {
	const alias = await offlineDb.keywordAliases.get(tempId);
	if (!alias) return;

	await offlineDb.transaction("rw", offlineDb.keywordAliases, async () => {
		await offlineDb.keywordAliases.delete(tempId);
		await offlineDb.keywordAliases.put(
			cleanOfflineKeywordAlias({ ...alias, id: serverId }),
		);
	});
}

export async function replaceKeywordVersionId(
	tempId: string,
	serverId: string,
): Promise<void> {
	const version = await offlineDb.keywordVersions.get(tempId);
	if (!version) return;

	await offlineDb.transaction("rw", offlineDb.keywordVersions, async () => {
		await offlineDb.keywordVersions.delete(tempId);
		await offlineDb.keywordVersions.put(
			cleanOfflineKeywordVersion({ ...version, id: serverId }),
		);
	});
}

export async function replaceReplacementId(
	tempId: string,
	serverId: string,
): Promise<void> {
	const replacement = await offlineDb.replacements.get(tempId);
	if (!replacement) return;

	await offlineDb.transaction("rw", offlineDb.replacements, async () => {
		await offlineDb.replacements.delete(tempId);
		await offlineDb.replacements.put(
			cleanOfflineReplacement({ ...replacement, id: serverId }),
		);
	});
}

export async function clearNovelOfflineData(novelId: string): Promise<void> {
	const rootIds = (await getKeywordsByNovelId(novelId)).map((k) => k.id);

	await offlineDb.transaction(
		"rw",
		[
			offlineDb.novels,
			offlineDb.keywords,
			offlineDb.keywordAliases,
			offlineDb.keywordVersions,
			offlineDb.replacements,
		],
		async () => {
			if (rootIds.length > 0) {
				await offlineDb.keywordAliases
					.where("keywordId")
					.anyOf(rootIds)
					.delete();
				await offlineDb.keywordVersions
					.where("keywordId")
					.anyOf(rootIds)
					.delete();
			}
			await offlineDb.keywords.where("novelId").equals(novelId).delete();
			await offlineDb.replacements.where("novelId").equals(novelId).delete();
			await offlineDb.novels.delete(novelId);
		},
	);
}

export type NovelOfflineBundle = {
	novel: DownloadedNovel;
	keywords: GetKeywords200DataItem[];
	replacements: OfflineReplacement[];
	categories: OfflineKeywordCategory[];
	natures: OfflineKeywordNature[];
};

export async function writeNovelOfflineBundle(
	bundle: NovelOfflineBundle,
): Promise<void> {
	await offlineDb.novels.put(bundle.novel);
	await bulkPutKeywordCategories(bundle.categories);
	await bulkPutKeywordNatures(bundle.natures);
	await replaceKeywordsForNovel(bundle.novel.id, bundle.keywords);
	await replaceReplacementsForNovel(bundle.novel.id, bundle.replacements);
}
