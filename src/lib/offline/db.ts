import Dexie, { type EntityTable } from "dexie";
import type { GetNovels200DataItem } from "@/api/generated/schemas";
import { getDownloadedNovelIds, getPendingDeletedEntityIds } from "@/lib/offline/sync-storage";
import type {
	CatalogNovel,
	DownloadedNovel,
	OfflineKeyword,
	OfflineKeywordCategory,
	OfflineKeywordNature,
	OfflineReplacement,
	OfflineWebsiteNovelBias,
} from "@/lib/offline/types";
import {
	cleanOfflineKeyword,
	cleanOfflineReplacement,
} from "@/lib/offline/types";

class StoryLensOfflineDatabase extends Dexie {
	catalogNovels!: EntityTable<CatalogNovel, "id">;
	novels!: EntityTable<DownloadedNovel, "id">;
	keywords!: EntityTable<OfflineKeyword, "id">;
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
			websiteNovelBiases: "id, novelId, websiteSelectorId, [novelId+websiteSelectorId]",
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

export async function getKeywordsByNovelId(
	novelId: string,
): Promise<OfflineKeyword[]> {
	return offlineDb.keywords.where("novelId").equals(novelId).toArray();
}

export async function getAliasesByParentId(
	parentId: string,
): Promise<OfflineKeyword[]> {
	return offlineDb.keywords.where("parentId").equals(parentId).toArray();
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
	if (ids.length === 0) {
		return [];
	}

	return offlineDb.novels
		.where("id")
		.anyOf(ids)
		.sortBy("name");
}

export async function getOfflineNovelBySlug(
	slug: string,
): Promise<DownloadedNovel | undefined> {
	const downloadedIds = await getDownloadedNovelIds();
	if (downloadedIds.length === 0) {
		return undefined;
	}

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

async function replaceKeywordsForNovel(
	novelId: string,
	serverKeywords: OfflineKeyword[],
): Promise<void> {
	const existing = await getKeywordsByNovelId(novelId);
	const dirtyKeywords = existing.filter((keyword) => keyword.isDirty);
	const dirtyIds = new Set(dirtyKeywords.map((keyword) => keyword.id));
	const pendingDeletes = await getPendingDeletedEntityIds(novelId, "keyword");

	const merged = [
		...serverKeywords
			.filter(
				(keyword) =>
					!dirtyIds.has(keyword.id) && !pendingDeletes.has(keyword.id),
			)
			.map((keyword) => cleanOfflineKeyword(keyword)),
		...dirtyKeywords,
	];

	await offlineDb.transaction("rw", offlineDb.keywords, async () => {
		await offlineDb.keywords.where("novelId").equals(novelId).delete();
		if (merged.length > 0) {
			await offlineDb.keywords.bulkPut(merged);
		}
	});
}

async function replaceReplacementsForNovel(
	novelId: string,
	serverReplacements: OfflineReplacement[],
): Promise<void> {
	const existing = await getReplacementsByNovelId(novelId);
	const dirtyReplacements = existing.filter((replacement) => replacement.isDirty);
	const dirtyIds = new Set(dirtyReplacements.map((replacement) => replacement.id));
	const pendingDeletes = await getPendingDeletedEntityIds(
		novelId,
		"replacement",
	);

	const merged = [
		...serverReplacements
			.filter(
				(replacement) =>
					!dirtyIds.has(replacement.id) && !pendingDeletes.has(replacement.id),
			)
			.map((replacement) => cleanOfflineReplacement(replacement)),
		...dirtyReplacements,
	];

	await offlineDb.transaction("rw", offlineDb.replacements, async () => {
		await offlineDb.replacements.where("novelId").equals(novelId).delete();
		if (merged.length > 0) {
			await offlineDb.replacements.bulkPut(merged);
		}
	});
}

export async function getBiasesByNovelId(
	novelId: string,
): Promise<OfflineWebsiteNovelBias[]> {
	return offlineDb.websiteNovelBiases.where("novelId").equals(novelId).toArray();
}

export async function replaceBiasesForNovel(
	novelId: string,
	serverBiases: OfflineWebsiteNovelBias[],
): Promise<void> {
	await offlineDb.transaction("rw", offlineDb.websiteNovelBiases, async () => {
		await offlineDb.websiteNovelBiases.where("novelId").equals(novelId).delete();
		if (serverBiases.length > 0) {
			await offlineDb.websiteNovelBiases.bulkPut(serverBiases);
		}
	});
}

export async function writeNovelContentCache(
	novel: CatalogNovel,
	keywords: OfflineKeyword[],
	replacements: OfflineReplacement[],
	biases: OfflineWebsiteNovelBias[] = [],
): Promise<void> {
	const downloaded = await isNovelDownloaded(novel.id);
	await saveCatalogNovel(novel);

	if (downloaded) {
		return;
	}

	await replaceKeywordsForNovel(novel.id, keywords);
	await replaceReplacementsForNovel(novel.id, replacements);
	await replaceBiasesForNovel(novel.id, biases);
}

export async function saveKeyword(keyword: OfflineKeyword): Promise<void> {
	await offlineDb.keywords.put(keyword);
}

export async function markKeywordDirty(id: string): Promise<void> {
	const keyword = await offlineDb.keywords.get(id);
	if (!keyword) {
		return;
	}

	await offlineDb.keywords.put({ ...keyword, isDirty: true });
}

export async function clearKeywordDirty(id: string): Promise<void> {
	const keyword = await offlineDb.keywords.get(id);
	if (!keyword?.isDirty) {
		return;
	}

	await offlineDb.keywords.put(cleanOfflineKeyword(keyword));
}

export async function saveReplacement(
	replacement: OfflineReplacement,
): Promise<void> {
	await offlineDb.replacements.put(replacement);
}

export async function markReplacementDirty(id: string): Promise<void> {
	const replacement = await offlineDb.replacements.get(id);
	if (!replacement) {
		return;
	}

	await offlineDb.replacements.put({ ...replacement, isDirty: true });
}

export async function clearReplacementDirty(id: string): Promise<void> {
	const replacement = await offlineDb.replacements.get(id);
	if (!replacement?.isDirty) {
		return;
	}

	await offlineDb.replacements.put(cleanOfflineReplacement(replacement));
}

export async function deleteKeywordById(id: string): Promise<void> {
	await offlineDb.keywords.delete(id);
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
	if (!category) {
		return;
	}

	const serverCategory = { ...category, id: serverId };
	const keywords = await offlineDb.keywords
		.filter((keyword) => keyword.categoryId === tempId)
		.toArray();

	await offlineDb.transaction(
		"rw",
		[offlineDb.keywordCategories, offlineDb.keywords],
		async () => {
			await offlineDb.keywordCategories.delete(tempId);
			await offlineDb.keywordCategories.put(serverCategory);
			await offlineDb.keywords.bulkPut(
				keywords.map((keyword) => ({
					...keyword,
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
	if (!nature) {
		return;
	}

	const serverNature = { ...nature, id: serverId };
	const keywords = await offlineDb.keywords
		.filter((keyword) => keyword.natureId === tempId)
		.toArray();

	await offlineDb.transaction(
		"rw",
		[offlineDb.keywordNatures, offlineDb.keywords],
		async () => {
			await offlineDb.keywordNatures.delete(tempId);
			await offlineDb.keywordNatures.put(serverNature);
			await offlineDb.keywords.bulkPut(
				keywords.map((keyword) => ({
					...keyword,
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
	const keywords = await offlineDb.keywords
		.filter((keyword) => keyword.categoryId === category.id)
		.toArray();

	await offlineDb.keywords.bulkPut(
		keywords.map((keyword) => ({ ...keyword, category })),
	);
}

export async function updateKeywordNatureReferences(
	nature: OfflineKeywordNature,
): Promise<void> {
	const keywords = await offlineDb.keywords
		.filter((keyword) => keyword.natureId === nature.id)
		.toArray();

	await offlineDb.keywords.bulkPut(
		keywords.map((keyword) => ({ ...keyword, nature })),
	);
}

export async function replaceKeywordId(
	tempId: string,
	serverId: string,
): Promise<void> {
	const keyword = await offlineDb.keywords.get(tempId);
	if (!keyword) {
		return;
	}

	await offlineDb.transaction("rw", offlineDb.keywords, async () => {
		await offlineDb.keywords.delete(tempId);
		await offlineDb.keywords.put(cleanOfflineKeyword({ ...keyword, id: serverId }));
	});
}

export async function replaceReplacementId(
	tempId: string,
	serverId: string,
): Promise<void> {
	const replacement = await offlineDb.replacements.get(tempId);
	if (!replacement) {
		return;
	}

	await offlineDb.transaction("rw", offlineDb.replacements, async () => {
		await offlineDb.replacements.delete(tempId);
		await offlineDb.replacements.put(
			cleanOfflineReplacement({ ...replacement, id: serverId }),
		);
	});
}

export async function clearNovelOfflineData(novelId: string): Promise<void> {
	await offlineDb.transaction(
		"rw",
		[offlineDb.novels, offlineDb.keywords, offlineDb.replacements],
		async () => {
			await offlineDb.keywords.where("novelId").equals(novelId).delete();
			await offlineDb.replacements.where("novelId").equals(novelId).delete();
			await offlineDb.novels.delete(novelId);
		},
	);
}

export type NovelOfflineBundle = {
	novel: DownloadedNovel;
	keywords: OfflineKeyword[];
	replacements: OfflineReplacement[];
	categories: OfflineKeywordCategory[];
	natures: OfflineKeywordNature[];
};

export async function writeNovelOfflineBundle(
	bundle: NovelOfflineBundle,
): Promise<void> {
	// Do not wrap in a single Dexie transaction: replaceKeywordsForNovel and
	// replaceReplacementsForNovel await chrome.storage (pending deletes), which
	// would auto-commit an outer transaction before writes finish.
	await offlineDb.novels.put(bundle.novel);
	await bulkPutKeywordCategories(bundle.categories);
	await bulkPutKeywordNatures(bundle.natures);
	await replaceKeywordsForNovel(bundle.novel.id, bundle.keywords);
	await replaceReplacementsForNovel(bundle.novel.id, bundle.replacements);
}
