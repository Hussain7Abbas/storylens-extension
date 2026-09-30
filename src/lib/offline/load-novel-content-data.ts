import { getStoredAuth } from "@/lib/auth/auth-storage";
import {
	isOfflineUnavailable,
	offlineDb,
	type StoryLensDatabase,
} from "@/lib/offline/db";
import { getMeta, requestRefresh } from "@/lib/offline/meta";
import { isOnline } from "@/lib/offline/online-status";
import { projectNovel } from "@/lib/offline/projection";
import { splitKeywords } from "@/lib/offline/snapshot";
import {
	fetchNovelBundle,
	fetchNovels,
	NOVEL_STALE_MS,
} from "@/lib/offline/sync/pull";
import { getCatalogueView, getNovelView } from "@/lib/offline/views";
import type { currentNovelMeta } from "@/types";
import type { NovelContentData } from "@/types/content-data";
import { findNovelBySlug } from "@/utils/novel-matching";
import { getStoredLanguage } from "@/utils/stored-language";
import { type Language, namedIn } from "@/utils/translation";

const LOG_PREFIX = "[StoryLens]";
/** How long a page waits for a first pull before rendering without data. */
export const FIRST_PULL_WAIT_MS = 10_000;

export type ContentDataDeps = {
	db?: StoryLensDatabase;
	/** Starts a runner pass (under the sync lock) that pulls what was requested. */
	kick: (options: { forceCatalogue?: boolean }) => Promise<unknown>;
	/** Records which novel a tab's slug resolved to. */
	onResolved?: (novelSlug: string, novelId: string) => Promise<void>;
	waitMs?: number;
};

/** Online-only mode (IndexedDB unavailable): the novel straight from the API. */
async function loadOnline(
	meta: currentNovelMeta,
	language: Language,
	token?: string | null,
): Promise<NovelContentData | undefined> {
	if (!isOnline()) return undefined;
	const novel = findNovelBySlug(
		await fetchNovels({ token: token ?? undefined }),
		meta.novelSlug,
	);
	if (!novel) return undefined;
	const bundle = await fetchNovelBundle(novel.id, {
		token: token ?? undefined,
	});
	const { keywords, aliases, versions } = splitKeywords(bundle.keywords);
	const view = projectNovel({
		novelId: novel.id,
		snapshot: {
			novel: bundle.novel,
			keywords,
			aliases,
			versions,
			replacements: bundle.replacements,
			biases: bundle.biases,
		},
		mutations: [],
		userId: null,
	});
	return {
		novel: bundle.novel,
		language,
		chapterNumber: meta.chapter,
		keywords: namedIn(view.keywords, language),
		replacements: view.replacements,
		biases: view.biases,
	};
}

async function waitFor(
	check: () => Promise<boolean>,
	timeoutMs: number,
): Promise<boolean> {
	const until = Date.now() + timeoutMs;
	while (Date.now() < until) {
		if (await check()) return true;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	return check();
}

/**
 * Page data for a detected novel, built from the local view (background only;
 * content scripts never open the extension database). A novel missing from the
 * catalogue or without a snapshot is pulled first when online (up to 10 s); a
 * stale one is served at once and refreshed in the background
 * (stale-while-revalidate). Both languages are stored, so a language switch
 * needs no network.
 */
export async function loadNovelContentDataForMeta(
	meta: currentNovelMeta,
	deps: ContentDataDeps,
): Promise<NovelContentData | undefined> {
	const db = deps.db ?? offlineDb();
	const waitMs = deps.waitMs ?? FIRST_PULL_WAIT_MS;
	const [language, { user, token }] = await Promise.all([
		getStoredLanguage(),
		getStoredAuth(),
	]);
	if (!deps.db && isOfflineUnavailable())
		return loadOnline(meta, language, token);

	let novel = findNovelBySlug(await getCatalogueView(db), meta.novelSlug);
	if (!novel && isOnline()) {
		const pulledBefore = (await getMeta("catalogPulledAt", db)) ?? 0;
		void deps.kick({ forceCatalogue: true });
		await waitFor(
			async () => ((await getMeta("catalogPulledAt", db)) ?? 0) > pulledBefore,
			waitMs,
		);
		novel = findNovelBySlug(await getCatalogueView(db), meta.novelSlug);
	}
	if (!novel) {
		console.warn(
			`${LOG_PREFIX} No novel matched slug "${meta.novelSlug}". Add the novel with this slug in the extension.`,
		);
		return undefined;
	}
	const novelId = novel.id;
	await deps.onResolved?.(meta.novelSlug, novelId);

	const sync = await db.novelSync.get(novelId);
	if (!sync?.lastPulledAt) {
		if (!isOnline()) return undefined;
		await requestRefresh(novelId, db);
		void deps.kick({});
		const pulled = await waitFor(
			async () => !!(await db.novelSync.get(novelId))?.lastPulledAt,
			waitMs,
		);
		if (!pulled) return undefined;
	} else if (
		Date.now() - sync.lastPulledAt > NOVEL_STALE_MS &&
		isOnline() &&
		!sync.pinned
	) {
		// Served now from local data; the refresh updates the tab when it lands.
		await requestRefresh(novelId, db);
		void deps.kick({});
	}

	const view = await getNovelView(novelId, user?.id, db);
	return {
		novel: view.novel ?? novel,
		language,
		chapterNumber: meta.chapter,
		keywords: namedIn(view.keywords, language),
		replacements: view.replacements,
		biases: view.biases,
	};
}
