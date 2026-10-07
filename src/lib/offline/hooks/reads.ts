import { useDebouncedValue } from "@mantine/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Dexie from "dexie";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { sendMessage } from "@/entrypoints/background/messaging";
import { getStoredAuth } from "@/lib/auth/auth-storage";
import { currentUserAtom } from "@/lib/auth/auth-store";
import { isOfflineUnavailable, offlineDb } from "@/lib/offline/db";
import { getMeta } from "@/lib/offline/meta";
import { isOnline, subscribeOnlineStatus } from "@/lib/offline/online-status";
import { projectNovel } from "@/lib/offline/projection";
import { splitKeywords } from "@/lib/offline/snapshot";
import {
	fetchLookups,
	fetchNovelBundle,
	fetchNovels,
} from "@/lib/offline/sync/pull";
import type {
	AliasRow,
	AssembledKeyword,
	CatalogNovel,
	CategoryRow,
	EntitySyncState,
	NatureRow,
	ReplacementRow,
} from "@/lib/offline/types";
import {
	type DownloadedNovel,
	getCatalogueView,
	getDownloadedNovels,
	getLookupsView,
	getNovelView,
} from "@/lib/offline/views";
import { localeAtom, useLanguage } from "@/store/locale";
import { fuzzyMatches } from "@/utils/fuzzy-search";
import { hasNameIn, type Language, namedIn, nameIn } from "@/utils/translation";

/** Every local read is under this key, so one invalidation refreshes them all. */
export const OFFLINE_QUERY_KEY = "offline";

/**
 * Keeps local reads fresh when another context (the background runner, the
 * launcher iframe, another popup) writes the database: Dexie's cross-context
 * `storagemutated` event invalidates the `["offline", …]` queries, and a cheap
 * change-counter check covers contexts the event does not reach.
 */
export function useOfflineInvalidation(): void {
	const queryClient = useQueryClient();
	useEffect(() => {
		const invalidate = () => {
			void queryClient.invalidateQueries({ queryKey: [OFFLINE_QUERY_KEY] });
		};
		Dexie.on("storagemutated", invalidate);
		let counter: number | undefined;
		const timer = setInterval(() => {
			if (isOfflineUnavailable()) return;
			void getMeta("changeCounter")
				.then((value) => {
					if (counter !== undefined && value !== counter) invalidate();
					counter = value;
				})
				.catch(() => undefined);
		}, 3000);
		return () => {
			Dexie.on("storagemutated").unsubscribe(invalidate);
			clearInterval(timer);
		};
	}, [queryClient]);
}

export function useOnlineStatus(): boolean {
	const [online, setOnline] = useState(isOnline());
	useEffect(
		() =>
			subscribeOnlineStatus(
				() => setOnline(true),
				() => setOnline(false),
			),
		[],
	);
	return online;
}

function useUserId(): string | undefined {
	return useAtomValue(currentUserAtom)?.id;
}

/**
 * Online-only mode (IndexedDB unavailable): the novel straight from the API,
 * projected without local changes (edits need offline storage).
 */
async function onlineNovelView(novelId: string) {
	const { token } = await getStoredAuth();
	const context = { token: token ?? undefined };
	const [bundle, lookups] = await Promise.all([
		fetchNovelBundle(novelId, context),
		fetchLookups(context),
	]);
	const { keywords, aliases, versions } = splitKeywords(bundle.keywords);
	const view = projectNovel({
		novelId,
		snapshot: {
			novel: bundle.novel,
			keywords,
			aliases,
			versions,
			replacements: bundle.replacements,
			biases: bundle.biases,
		},
		lookups: { ...lookups, states: new Map() },
		mutations: [],
		userId: null,
	});
	return { ...view, hasSnapshot: true, removedOnServer: false };
}

/** A novel's view (snapshot plus this account's changes). */
export function useNovelView(novelId: string | undefined) {
	const userId = useUserId();
	return useQuery({
		networkMode: "always",
		queryKey: [OFFLINE_QUERY_KEY, "novel-view", novelId, userId],
		queryFn: async () => {
			if (isOfflineUnavailable()) return onlineNovelView(novelId as string);
			const view = await getNovelView(novelId as string, userId);
			const sync = await offlineDb().novelSync.get(novelId as string);
			return {
				...view,
				hasSnapshot: !!sync?.lastPulledAt,
				removedOnServer: !!sync?.removedOnServer,
			};
		},
		enabled: !!novelId,
	});
}

/**
 * With no local copy of the novel yet, asks the background to pull it (online)
 * and reports whether the reader must wait or is offline without data.
 */
function useEnsureNovel(
	novelId: string | undefined,
	hasSnapshot: boolean | undefined,
) {
	const online = useOnlineStatus();
	useEffect(() => {
		if (!novelId || hasSnapshot !== false || !online) return;
		void sendMessage("requestNovelRefresh", novelId).catch(() => undefined);
	}, [novelId, hasSnapshot, online]);
	return {
		notAvailableOffline: hasSnapshot === false && !online,
		waitingForPull: hasSnapshot === false && online,
	};
}

function searchKeywords(
	items: AssembledKeyword[],
	search: string,
	language: Language,
): AssembledKeyword[] {
	const sorted = [...items].sort((left, right) =>
		nameIn(left, language).localeCompare(nameIn(right, language)),
	);
	if (!search) return sorted;
	return sorted.filter((item) =>
		fuzzyMatches(search, [
			item.nameAr,
			item.nameEn,
			...item.aliases.flatMap((alias) => [alias.nameAr, alias.nameEn]),
		]),
	);
}

/** A novel's keywords (named in the UI language), searched and sorted, from its view. */
export function useOfflineKeywords(novelId: string, search: string) {
	const language = useLanguage();
	const [debouncedSearch] = useDebouncedValue(search.trim(), 300);
	const query = useNovelView(novelId || undefined);
	const { downloadedIds } = useDownloadedNovelIds();
	const ensured = useEnsureNovel(novelId || undefined, query.data?.hasSnapshot);
	const items = useMemo(
		() =>
			searchKeywords(
				namedIn(query.data?.keywords ?? [], language),
				debouncedSearch,
				language,
			),
		[query.data, debouncedSearch, language],
	);
	return {
		items,
		states: query.data?.states ?? new Map<string, EntitySyncState>(),
		isDownloaded: downloadedIds.has(novelId),
		useLocalCache: true,
		isLoading: query.isLoading || ensured.waitingForPull,
		notAvailableOffline: ensured.notAvailableOffline,
		removedOnServer: query.data?.removedOnServer ?? false,
		isFetchingNextPage: false,
		loadMoreRef: undefined as React.RefObject<HTMLDivElement> | undefined,
	};
}

/** Every keyword of a novel (all names, unsearched), for pickers and extraction. */
export function useNovelKeywords(novelId: string | undefined): {
	keywords: AssembledKeyword[];
	isLoading: boolean;
} {
	const language = useLanguage();
	const query = useNovelView(novelId);
	const ensured = useEnsureNovel(novelId, query.data?.hasSnapshot);
	const keywords = useMemo(
		() => namedIn(query.data?.keywords ?? [], language),
		[query.data, language],
	);
	return { keywords, isLoading: query.isLoading || ensured.waitingForPull };
}

/** Which rows a form's **Link** may offer: see `useTranslationKeywords`. */
export type TranslationCandidates = {
	/** The language tab's own: a candidate must be named in it. */
	language: Language;
	/** The reader's language: a candidate must not be named in it. */
	without: Language;
	/** The row being saved. */
	exceptId?: string;
	/** The surviving row's stored name in `language`, which a link must not replace. */
	targetName?: string | null;
};

function offersTranslation<
	T extends { id: string; nameAr?: string | null; nameEn?: string | null },
>(
	rows: T[],
	{ language, without, exceptId, targetName }: TranslationCandidates,
): T[] {
	return rows.filter(
		(row) =>
			row.id !== exceptId &&
			hasNameIn(row, language) &&
			!hasNameIn(row, without) &&
			(!targetName?.trim() || nameIn(row, language) === targetName.trim()),
	);
}

/**
 * **Link** candidates for a keyword form's other-language tab: the novel's
 * keywords named in that tab's language and not in the reader's, so merging one
 * in can only add the name this keyword lacks. Ordinary lists filter by the
 * reader's language, so these rows do not show there.
 */
export function useTranslationKeywords(
	novelId: string | undefined,
	candidates: TranslationCandidates,
): { keywords: AssembledKeyword[]; isLoading: boolean } {
	const query = useNovelView(novelId);
	const { language, without, exceptId, targetName } = candidates;
	const keywords = useMemo(
		() =>
			offersTranslation(query.data?.keywords ?? [], {
				language,
				without,
				exceptId,
				targetName,
			}),
		[query.data, language, without, exceptId, targetName],
	);
	return { keywords, isLoading: query.isLoading };
}

/**
 * **Link** candidates for an alias form's other-language tab: the parent
 * keyword's other aliases, by the same rule. An alias never moves between
 * keywords, so only siblings are offered (`mergeTranslationAlias`).
 */
export function useTranslationAliases(
	novelId: string | undefined,
	keywordId: string | undefined,
	candidates: TranslationCandidates,
): { aliases: AliasRow[]; isLoading: boolean } {
	const query = useNovelView(novelId);
	const { language, without, exceptId, targetName } = candidates;
	const aliases = useMemo(() => {
		const parent = query.data?.keywords.find((item) => item.id === keywordId);
		return offersTranslation(parent?.aliases ?? [], {
			language,
			without,
			exceptId,
			targetName,
		});
	}, [query.data, keywordId, language, without, exceptId, targetName]);
	return { aliases, isLoading: query.isLoading };
}

export function useOfflineKeywordAliases(
	keywordId: string | undefined,
	novelId?: string,
) {
	const query = useNovelView(novelId);
	const aliases = useMemo(
		() =>
			query.data?.keywords.find((keyword) => keyword.id === keywordId)
				?.aliases ?? [],
		[query.data, keywordId],
	);
	return { aliases, isLoading: query.isLoading };
}

export function useOfflineReplacements(novelId: string, search: string) {
	const [debouncedSearch] = useDebouncedValue(search.trim(), 300);
	const query = useNovelView(novelId || undefined);
	const { downloadedIds } = useDownloadedNovelIds();
	const ensured = useEnsureNovel(novelId || undefined, query.data?.hasSnapshot);
	const items = useMemo(() => {
		const rows: ReplacementRow[] = [...(query.data?.replacements ?? [])].sort(
			(left, right) => left.from.localeCompare(right.from),
		);
		return debouncedSearch
			? rows.filter((row) => fuzzyMatches(debouncedSearch, [row.from, row.to]))
			: rows;
	}, [query.data, debouncedSearch]);
	return {
		items,
		states: query.data?.states ?? new Map<string, EntitySyncState>(),
		isDownloaded: downloadedIds.has(novelId),
		useLocalCache: true,
		isLoading: query.isLoading || ensured.waitingForPull,
		notAvailableOffline: ensured.notAvailableOffline,
		isFetchingNextPage: false,
		loadMoreRef: undefined as React.RefObject<HTMLDivElement> | undefined,
	};
}

/** A novel's chapter biases, from its view. */
export function useNovelBiases(novelId: string | undefined) {
	const query = useNovelView(novelId);
	return { biases: query.data?.biases ?? [], isLoading: query.isLoading };
}

function useLookupsView() {
	const userId = useUserId();
	return useQuery({
		networkMode: "always",
		queryKey: [OFFLINE_QUERY_KEY, "lookups", userId],
		queryFn: async () => {
			if (!isOfflineUnavailable()) return getLookupsView(userId);
			const { token } = await getStoredAuth();
			return {
				...(await fetchLookups({ token: token ?? undefined })),
				states: new Map<string, EntitySyncState>(),
			};
		},
	});
}

function sortLookups<T extends CategoryRow | NatureRow>(
	items: T[],
	search: string,
	locale: string,
): T[] {
	const pick = (item: T) =>
		locale === "ar"
			? (item.nameAr ?? item.nameEn ?? "")
			: (item.nameEn ?? item.nameAr ?? "");
	const filtered = search
		? items.filter((item) => fuzzyMatches(search, [item.nameAr, item.nameEn]))
		: items;
	return [...filtered].sort((left, right) =>
		pick(left).localeCompare(pick(right)),
	);
}

export function useOfflineKeywordCategories(search = "") {
	const [debouncedSearch] = useDebouncedValue(search.trim(), 300);
	const locale = useAtomValue(localeAtom);
	const query = useLookupsView();
	const data = useMemo(
		() => sortLookups(query.data?.categories ?? [], debouncedSearch, locale),
		[query.data, debouncedSearch, locale],
	);
	return {
		data,
		states: query.data?.states ?? new Map<string, EntitySyncState>(),
		isLoading: query.isLoading,
	};
}

export function useOfflineKeywordNatures(search = "") {
	const [debouncedSearch] = useDebouncedValue(search.trim(), 300);
	const locale = useAtomValue(localeAtom);
	const query = useLookupsView();
	const data = useMemo(
		() => sortLookups(query.data?.natures ?? [], debouncedSearch, locale),
		[query.data, debouncedSearch, locale],
	);
	return {
		data,
		states: query.data?.states ?? new Map<string, EntitySyncState>(),
		isLoading: query.isLoading,
	};
}

/** Catalogue novels named in the UI language, sorted by that name. The runner refreshes the catalogue. */
export function useCachedNovelsList(): {
	novels: CatalogNovel[];
	isLoading: boolean;
	refresh: () => void;
} {
	const language = useLanguage();
	const query = useQuery({
		networkMode: "always",
		queryKey: [OFFLINE_QUERY_KEY, "catalogue"],
		queryFn: async () => {
			if (!isOfflineUnavailable()) return getCatalogueView();
			const { token } = await getStoredAuth();
			return fetchNovels({ token: token ?? undefined });
		},
	});
	const novels = useMemo(
		() =>
			namedIn(query.data ?? [], language).sort((left, right) =>
				nameIn(left, language).localeCompare(nameIn(right, language)),
			),
		[query.data, language],
	);
	return {
		novels,
		isLoading: query.isLoading,
		refresh: () => {
			void sendMessage("syncKick", {
				reason: "popup-open",
				pull: "stale",
			}).catch(() => undefined);
			void query.refetch();
		},
	};
}

export function useDownloadedNovelsList(): {
	novels: DownloadedNovel[];
	isLoading: boolean;
	refresh: () => void;
} {
	const query = useQuery({
		networkMode: "always",
		queryKey: [OFFLINE_QUERY_KEY, "downloaded-novels"],
		queryFn: () => getDownloadedNovels(),
	});
	return {
		novels: query.data ?? [],
		isLoading: query.isLoading,
		refresh: () => void query.refetch(),
	};
}

export function useDownloadedNovelIds(): {
	downloadedIds: Set<string>;
	isLoading: boolean;
	refresh: () => void;
} {
	const { novels, isLoading, refresh } = useDownloadedNovelsList();
	const downloadedIds = useMemo(
		() => new Set(novels.map((novel) => novel.id)),
		[novels],
	);
	return { downloadedIds, isLoading, refresh };
}
