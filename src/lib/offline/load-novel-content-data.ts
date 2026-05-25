import { getKeywords } from "@/api/generated/endpoints/keywords.js";
import { getNovels } from "@/api/generated/endpoints/novels.js";
import { getReplacements } from "@/api/generated/endpoints/replacements.js";
import {
	getAllCatalogNovels,
	getCatalogNovelBySlug,
	getKeywordsByNovelId,
	getOfflineNovelBySlug,
	getReplacementsByNovelId,
	writeNovelContentCache,
} from "@/lib/offline/db";
import { isOnline } from "@/lib/offline/online-status";
import type { currentNovelMeta } from "@/types";
import type { NovelContentData } from "@/types/content-data";
import {
	KEYWORD_LIST_SORTING,
	REPLACEMENT_LIST_SORTING,
	withListQueryParams,
} from "@/utils/api-list-params";
import { findNovelBySlug } from "@/utils/novel-matching";

const LOG_PREFIX = "[StoryLens]";
const CONTENT_PAGE_SIZE = 500;

async function loadLocalNovelContentData(
	novelSlug: string,
	chapter?: number,
): Promise<NovelContentData | undefined> {
	const downloadedNovel = await getOfflineNovelBySlug(novelSlug);
	if (downloadedNovel) {
		const [keywords, replacements] = await Promise.all([
			getKeywordsByNovelId(downloadedNovel.id),
			getReplacementsByNovelId(downloadedNovel.id),
		]);

		console.log(`${LOG_PREFIX} Loaded downloaded novel content from local DB`, {
			novelId: downloadedNovel.id,
			keywordsCount: keywords.length,
			replacementsCount: replacements.length,
		});

		return {
			novel: downloadedNovel,
			chapterNumber: chapter,
			keywords,
			replacements,
		};
	}

	const catalogNovel = await getCatalogNovelBySlug(novelSlug);
	if (!catalogNovel) {
		return undefined;
	}

	const [keywords, replacements] = await Promise.all([
		getKeywordsByNovelId(catalogNovel.id),
		getReplacementsByNovelId(catalogNovel.id),
	]);

	if (keywords.length === 0 && replacements.length === 0) {
		return undefined;
	}

	console.log(`${LOG_PREFIX} Loaded cached novel content from local DB`, {
		novelId: catalogNovel.id,
		keywordsCount: keywords.length,
		replacementsCount: replacements.length,
	});

	return {
		novel: catalogNovel,
		chapterNumber: chapter,
		keywords,
		replacements,
	};
}

async function loadRemoteNovelContentData(
	meta: currentNovelMeta,
): Promise<NovelContentData | undefined> {
	const catalogNovels = await getAllCatalogNovels();
	let novel = findNovelBySlug(catalogNovels, meta.novelSlug);

	if (!novel) {
		const novelsResponse = await getNovels(
			withListQueryParams({
				pagination: { page: 1, pageSize: CONTENT_PAGE_SIZE },
				sorting: { column: "name", direction: "asc" },
			}),
		);
		novel = findNovelBySlug(novelsResponse.data.data, meta.novelSlug);
	}

	if (!novel) {
		console.warn(
			`${LOG_PREFIX} No database novel matched slug "${meta.novelSlug}". Add the novel with this slug in the extension.`,
		);
		return undefined;
	}

	const [keywordsResponse, replacementsResponse] = await Promise.all([
		getKeywords(
			withListQueryParams(
				{
					pagination: { page: 1, pageSize: CONTENT_PAGE_SIZE },
					query: { novelId: novel.id },
				},
				KEYWORD_LIST_SORTING,
			),
		),
		getReplacements(
			withListQueryParams(
				{
					pagination: { page: 1, pageSize: CONTENT_PAGE_SIZE },
					query: { novelId: novel.id },
				},
				REPLACEMENT_LIST_SORTING,
			),
		),
	]);

	const data: NovelContentData = {
		novel,
		chapterNumber: meta.chapter,
		keywords: keywordsResponse.data.data,
		replacements: replacementsResponse.data.data,
	};

	await writeNovelContentCache(novel, data.keywords, data.replacements);

	console.log(`${LOG_PREFIX} Loaded novel content from API and cached locally`, {
		novelId: novel.id,
		keywordsCount: data.keywords.length,
		replacementsCount: data.replacements.length,
	});

	return data;
}

export async function loadNovelContentDataForMeta(
	meta: currentNovelMeta,
): Promise<NovelContentData | undefined> {
	console.log(`${LOG_PREFIX} Loading content data for detected novel`, meta);

	const localData = await loadLocalNovelContentData(
		meta.novelSlug,
		meta.chapter,
	);
	if (localData) {
		return localData;
	}

	if (!isOnline()) {
		return undefined;
	}

	try {
		return await loadRemoteNovelContentData(meta);
	} catch (error) {
		console.error(
			`${LOG_PREFIX} Failed to load novel content data from API`,
			error,
		);
		return undefined;
	}
}
