import { getKeywordCategories } from "@/api/generated/endpoints/keyword-categories.js";
import { getKeywordNatures } from "@/api/generated/endpoints/keyword-natures.js";
import { getKeywords } from "@/api/generated/endpoints/keywords.js";
import { getNovelsById } from "@/api/generated/endpoints/novels.js";
import { getReplacements } from "@/api/generated/endpoints/replacements.js";
import type {
	GetKeywords200DataItem,
	GetReplacements200DataItem,
} from "@/api/generated/schemas";
import {
	clearNovelOfflineData,
	getDownloadedNovels,
	isNovelDownloaded,
	saveCatalogNovel,
	writeNovelOfflineBundle,
} from "@/lib/offline/db";
import {
	addDownloadedNovelId,
	getDownloadedNovelIds,
	removeDownloadedNovelId,
} from "@/lib/offline/sync-storage";
import type { DownloadedNovel } from "@/lib/offline/types";
import {
	KEYWORD_LIST_SORTING,
	REPLACEMENT_LIST_SORTING,
	withListQueryParams,
} from "@/utils/api-list-params";

const DOWNLOAD_PAGE_SIZE = 500;

async function fetchAllKeywords(
	novelId: string,
): Promise<GetKeywords200DataItem[]> {
	const response = await getKeywords(
		withListQueryParams(
			{
				pagination: { page: 1, pageSize: DOWNLOAD_PAGE_SIZE },
				query: { novelId },
			},
			KEYWORD_LIST_SORTING,
		),
	);
	return response.data.data;
}

async function fetchAllReplacements(
	novelId: string,
): Promise<GetReplacements200DataItem[]> {
	const response = await getReplacements(
		withListQueryParams(
			{
				pagination: { page: 1, pageSize: DOWNLOAD_PAGE_SIZE },
				query: { novelId },
			},
			REPLACEMENT_LIST_SORTING,
		),
	);
	return response.data.data;
}

export async function downloadNovel(novelId: string): Promise<void> {
	const locale = (() => {
		try {
			return JSON.parse(localStorage.getItem("locale") ?? '"en"');
		} catch {
			return "en";
		}
	})();
	const nameSortCol = locale === "ar" ? "nameAr" : "nameEn";

	const [
		novelResponse,
		keywords,
		replacements,
		categoriesResponse,
		naturesResponse,
	] = await Promise.all([
		getNovelsById(novelId),
		fetchAllKeywords(novelId),
		fetchAllReplacements(novelId),
		getKeywordCategories(
			withListQueryParams({
				pagination: { page: 1, pageSize: 500 },
				sorting: { column: nameSortCol, direction: "asc" },
			}),
		),
		getKeywordNatures(
			withListQueryParams({
				pagination: { page: 1, pageSize: 500 },
				sorting: { column: nameSortCol, direction: "asc" },
			}),
		),
	]);

	const novel: DownloadedNovel = {
		id: novelResponse.data.id,
		name: novelResponse.data.name,
		description: novelResponse.data.description,
		slugs: novelResponse.data.slugs,
		imageId: novelResponse.data.imageId,
		createdById: novelResponse.data.createdById,
		createdAt: novelResponse.data.createdAt,
		updatedAt: novelResponse.data.updatedAt,
		downloadedAt: Date.now(),
	};

	await writeNovelOfflineBundle({
		novel,
		keywords,
		replacements,
		categories: categoriesResponse.data.data,
		natures: naturesResponse.data.data,
	});

	await saveCatalogNovel(novelResponse.data);
	await addDownloadedNovelId(novelId);
}

export async function removeDownloadedNovel(novelId: string): Promise<void> {
	await clearNovelOfflineData(novelId);
	await removeDownloadedNovelId(novelId);
}

export async function getDownloadedNovelIdSet(): Promise<Set<string>> {
	const ids = await getDownloadedNovelIds();
	return new Set(ids);
}

export { getDownloadedNovels, isNovelDownloaded };
