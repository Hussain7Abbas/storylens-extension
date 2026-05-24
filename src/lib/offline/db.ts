import Dexie, { type EntityTable } from "dexie";
import type {
	DownloadedNovel,
	OfflineKeyword,
	OfflineKeywordCategory,
	OfflineKeywordNature,
	OfflineReplacement,
} from "@/lib/offline/types";

class StoryLensOfflineDatabase extends Dexie {
	novels!: EntityTable<DownloadedNovel, "id">;
	keywords!: EntityTable<OfflineKeyword, "id">;
	replacements!: EntityTable<OfflineReplacement, "id">;
	keywordCategories!: EntityTable<OfflineKeywordCategory, "id">;
	keywordNatures!: EntityTable<OfflineKeywordNature, "id">;

	constructor() {
		super("storylens-offline");

		this.version(1).stores({
			novels: "id, name, downloadedAt",
			keywords: "id, novelId, name, categoryId, natureId",
			replacements: "id, novelId, from",
			keywordCategories: "id, name",
			keywordNatures: "id, name",
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
	const novel = await offlineDb.novels.get(novelId);
	return novel !== undefined;
}

export async function getKeywordsByNovelId(
	novelId: string,
): Promise<OfflineKeyword[]> {
	return offlineDb.keywords.where("novelId").equals(novelId).toArray();
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
	return offlineDb.novels.orderBy("name").toArray();
}

export async function getOfflineNovelBySlug(
	slug: string,
): Promise<DownloadedNovel | undefined> {
	const normalized = slug.trim().toLowerCase();
	const novels = await offlineDb.novels.toArray();
	return novels.find((novel) =>
		novel.slugs.some((entry) => entry.trim().toLowerCase() === normalized),
	);
}

export async function saveKeyword(keyword: OfflineKeyword): Promise<void> {
	await offlineDb.keywords.put(keyword);
}

export async function saveReplacement(
	replacement: OfflineReplacement,
): Promise<void> {
	await offlineDb.replacements.put(replacement);
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
		await offlineDb.keywords.put({ ...keyword, id: serverId });
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
		await offlineDb.replacements.put({ ...replacement, id: serverId });
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
	await offlineDb.transaction(
		"rw",
		[
			offlineDb.novels,
			offlineDb.keywords,
			offlineDb.replacements,
			offlineDb.keywordCategories,
			offlineDb.keywordNatures,
		],
		async () => {
			await offlineDb.novels.put(bundle.novel);
			await offlineDb.keywords
				.where("novelId")
				.equals(bundle.novel.id)
				.delete();
			await offlineDb.replacements
				.where("novelId")
				.equals(bundle.novel.id)
				.delete();
			await offlineDb.keywords.bulkPut(bundle.keywords);
			await offlineDb.replacements.bulkPut(bundle.replacements);
			await offlineDb.keywordCategories.bulkPut(bundle.categories);
			await offlineDb.keywordNatures.bulkPut(bundle.natures);
		},
	);
}
