import type {
	GetKeywords200,
	GetNovels200,
	GetReplacements200,
} from "@/api/schemas";
import { sendMessage } from "@/entrypoints/background/messaging";
import type { currentNovelMeta } from "@/types";
import type { NovelContentData } from "@/types/content-data";
import {
	KEYWORD_LIST_SORTING,
	REPLACEMENT_LIST_SORTING,
	withListQueryParams,
} from "@/utils/api-list-params";
import { extensionApiGet } from "@/utils/api-proxy-client";
import { findNovelBySlug } from "@/utils/novel-matching";

const LOG_PREFIX = "[StoryLens]";

async function loadOfflineNovelContentData(
	meta: currentNovelMeta,
): Promise<NovelContentData | undefined> {
	try {
		const offlineData = await sendMessage("getOfflineNovelData", {
			novelSlug: meta.novelSlug,
			chapter: meta.chapter,
		});
		if (offlineData) {
			console.log(`${LOG_PREFIX} Loaded offline novel content data`, {
				novelId: offlineData.novel.id,
				keywordsCount: offlineData.keywords.length,
				replacementsCount: offlineData.replacements.length,
			});
			return offlineData;
		}
	} catch (error) {
		console.error(
			`${LOG_PREFIX} Failed to load offline novel content data`,
			error,
		);
	}

	return undefined;
}

export async function loadNovelContentData(
	meta: currentNovelMeta,
): Promise<NovelContentData | undefined> {
	console.log(`${LOG_PREFIX} Loading content data for detected novel`, meta);

	try {
		const novelsResponse = await extensionApiGet<GetNovels200>(
			"/novels/",
			withListQueryParams(),
		);
		const novels = novelsResponse.data;
		const novel = findNovelBySlug(novels, meta.novelSlug);

		if (!novel) {
			console.warn(
				`${LOG_PREFIX} No database novel matched slug "${meta.novelSlug}". Add the novel with this slug in the extension.`,
			);
			return loadOfflineNovelContentData(meta);
		}

		console.log(`${LOG_PREFIX} Matched database novel`, {
			id: novel.id,
			name: novel.name,
			slugs: novel.slugs,
			chapterNumber: meta.chapter,
		});

		const [keywordsResponse, replacementsResponse] = await Promise.all([
			extensionApiGet<GetKeywords200>(
				"/keywords/",
				withListQueryParams(
					{
						pagination: { page: 1, pageSize: 500 },
						query: { novelId: novel.id },
					},
					KEYWORD_LIST_SORTING,
				),
			),
			extensionApiGet<GetReplacements200>(
				"/replacements/",
				withListQueryParams(
					{
						pagination: { page: 1, pageSize: 500 },
						query: { novelId: novel.id },
					},
					REPLACEMENT_LIST_SORTING,
				),
			),
		]);

		const keywords = keywordsResponse.data;
		const replacements = replacementsResponse.data;

		console.log(`${LOG_PREFIX} Loaded novel content data`, {
			novelId: novel.id,
			novelName: novel.name,
			chapterNumber: meta.chapter,
			keywordsCount: keywords.length,
			replacementsCount: replacements.length,
		});

		return {
			novel,
			chapterNumber: meta.chapter,
			keywords,
			replacements,
		};
	} catch (error) {
		console.error(
			`${LOG_PREFIX} Failed to load novel content data from API`,
			error,
		);
		return loadOfflineNovelContentData(meta);
	}
}
