import { useDebouncedValue } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	deleteKeywordCategoriesById,
	getKeywordCategories,
	postKeywordCategories,
	putKeywordCategoriesById,
} from "@/api/generated/endpoints/keyword-categories.js";
import {
	deleteKeywordNaturesById,
	getKeywordNatures,
	postKeywordNatures,
	putKeywordNaturesById,
} from "@/api/generated/endpoints/keyword-natures.js";
import {
	deleteKeywordAliasesById,
	deleteKeywordsById,
	deleteKeywordVersionsById,
	postKeywordAliases,
	postKeywords,
	postKeywordVersions,
	putKeywordAliasesById,
	putKeywordsById,
	putKeywordVersionsById,
} from "@/api/generated/endpoints/keywords.js";
import {
	deleteReplacementsById,
	postReplacements,
	putReplacementsById,
} from "@/api/generated/endpoints/replacements.js";
import type {
	GetKeywords200DataItem,
	GetKeywords200DataItemAliasesItem,
	GetKeywords200DataItemVersionsItem,
	GetReplacements200DataItem,
	PostKeywordAliasesBodyOne,
	PostKeywordCategoriesBodyOne,
	PostKeywordNaturesBodyOne,
	PostKeywordsBodyOne,
	PostKeywordVersionsBodyOne,
	PostReplacementsBodyOne,
	PutKeywordAliasesByIdBodyOne,
	PutKeywordsByIdBodyOne,
	PutKeywordVersionsByIdBodyOne,
	PutReplacementsByIdBodyOne,
} from "@/api/generated/schemas";
import { withBackgroundSync } from "@/lib/offline/background-sync";
import {
	bulkPutKeywordCategories,
	bulkPutKeywordNatures,
	deleteKeywordAliasById,
	deleteKeywordById,
	deleteKeywordCategoryById,
	deleteKeywordNatureById,
	deleteKeywordVersionById,
	deleteReplacementById,
	getAliasesByKeywordId,
	getAllCatalogNovels,
	getAllKeywordCategories,
	getAllKeywordNatures,
	getAssembledKeywordsByNovelId,
	getCatalogNovelById,
	getDownloadedNovels,
	getKeywordAliasById,
	getKeywordById,
	getKeywordVersionById,
	getReplacementsByNovelId,
	getVersionsByKeywordId,
	markKeywordAliasDirty,
	markKeywordDirty,
	markKeywordVersionDirty,
	markReplacementDirty,
	saveCatalogNovel,
	saveKeyword,
	saveKeywordAlias,
	saveKeywordCategory,
	saveKeywordNature,
	saveKeywordVersion,
	saveReplacement,
	updateKeywordCategoryReferences,
	updateKeywordNatureReferences,
} from "@/lib/offline/db";
import { isOnline, subscribeOnlineStatus } from "@/lib/offline/online-status";
import { refreshNovelsCatalog } from "@/lib/offline/seed-novels-catalog";
import {
	addPendingOp,
	getDownloadedNovelIds,
	getPendingEntityIds,
	getPendingOpsCount,
} from "@/lib/offline/sync-storage";
import type {
	CatalogNovel,
	DownloadedNovel,
	OfflineKeyword,
	OfflineKeywordAlias,
	OfflineKeywordVersion,
	OfflineReplacement,
} from "@/lib/offline/types";
import {
	cleanOfflineKeyword,
	cleanOfflineKeywordAlias,
	cleanOfflineKeywordVersion,
	cleanOfflineReplacement,
	createTempId,
	GLOBAL_LOOKUP_SCOPE,
	isTempId,
	type SyncAction,
	type SyncEntity,
	type SyncOperation,
} from "@/lib/offline/types";
import { localeAtom } from "@/store/locale";
import { useActiveSyncCount } from "@/store/sync-status";
import type { KeywordCategory, KeywordNature } from "@/types/models";
import { withListQueryParams } from "@/utils/api-list-params";
import { refreshContentScript } from "@/utils/refresh-content-script";

function filterBySearch<
	T extends {
		name?: string | null;
		nameEn?: string | null;
		nameAr?: string | null;
		from?: string;
		to?: string;
	},
>(items: T[], search: string): T[] {
	const term = search.trim().toLowerCase();
	if (!term) {
		return items;
	}

	return items.filter((item) => {
		const values = [
			item.name,
			item.nameEn,
			item.nameAr,
			item.from,
			item.to,
		].filter(Boolean);
		return values.some((value) => value?.toLowerCase().includes(term));
	});
}

function sortKeywords(
	items: GetKeywords200DataItem[],
): GetKeywords200DataItem[] {
	return [...items].sort((left, right) => left.name.localeCompare(right.name));
}

function sortReplacements(
	items: GetReplacements200DataItem[],
): GetReplacements200DataItem[] {
	return [...items].sort((left, right) => left.from.localeCompare(right.from));
}

function sortLookupByName<
	T extends { name?: string; nameEn?: string | null; nameAr?: string | null },
>(items: T[], locale: string): T[] {
	return [...items].sort((left, right) => {
		const pick = (item: T) =>
			locale === "ar"
				? (item.nameAr ?? item.nameEn ?? item.name ?? "")
				: (item.nameEn ?? item.nameAr ?? item.name ?? "");
		return pick(left).localeCompare(pick(right));
	});
}

async function seedKeywordCategoriesCache(
	locale: string,
): Promise<KeywordCategory[]> {
	const response = await getKeywordCategories(
		withListQueryParams({
			pagination: { page: 1, pageSize: 500 },
			sorting: {
				column: locale === "ar" ? "nameAr" : "nameEn",
				direction: "asc",
			},
		}),
	);
	const data = response.data.data as KeywordCategory[];
	await bulkPutKeywordCategories(data);
	return data;
}

async function seedKeywordNaturesCache(
	locale: string,
): Promise<KeywordNature[]> {
	const response = await getKeywordNatures(
		withListQueryParams({
			pagination: { page: 1, pageSize: 500 },
			sorting: {
				column: locale === "ar" ? "nameAr" : "nameEn",
				direction: "asc",
			},
		}),
	);
	const data = response.data.data as KeywordNature[];
	await bulkPutKeywordNatures(data);
	return data;
}

function runBackgroundSync(
	task: () => Promise<void>,
	invalidate: () => void,
): void {
	void withBackgroundSync(async () => {
		try {
			await task();
		} finally {
			invalidate();
		}
	});
}

export function useActiveBackgroundSyncCount(): number {
	return useActiveSyncCount();
}

export function useCachedNovelsList(): {
	novels: CatalogNovel[];
	isLoading: boolean;
	refresh: () => void;
} {
	const online = useOnlineStatus();
	const queryClient = useQueryClient();

	const catalogQuery = useQuery({
		queryKey: ["offline", "catalog-novels"],
		queryFn: getAllCatalogNovels,
	});

	const refreshQuery = useQuery({
		queryKey: ["novels", "catalog-refresh"],
		queryFn: async () => {
			const data = await refreshNovelsCatalog();
			await queryClient.invalidateQueries({
				queryKey: ["offline", "catalog-novels"],
			});
			return data;
		},
		enabled: online,
		staleTime: 5 * 60 * 1000,
	});

	const novels = useMemo(() => {
		if (catalogQuery.data?.length) {
			return catalogQuery.data;
		}
		return refreshQuery.data ?? [];
	}, [catalogQuery.data, refreshQuery.data]);

	const isLoading =
		novels.length === 0 &&
		(catalogQuery.isLoading || (online && refreshQuery.isLoading));

	return {
		novels,
		isLoading,
		refresh: () => {
			void refreshQuery.refetch();
		},
	};
}

export function useOnlineStatus(): boolean {
	const [online, setOnline] = useState(isOnline());

	useEffect(() => {
		return subscribeOnlineStatus(
			() => setOnline(true),
			() => setOnline(false),
		);
	}, []);

	return online;
}

export function useDownloadedNovelIds(): {
	downloadedIds: Set<string>;
	isLoading: boolean;
	refresh: () => void;
} {
	const query = useQuery({
		queryKey: ["offline", "downloaded-novel-ids"],
		queryFn: async () => new Set(await getDownloadedNovelIds()),
	});

	return {
		downloadedIds: query.data ?? new Set<string>(),
		isLoading: query.isLoading,
		refresh: () => {
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
		queryKey: ["offline", "downloaded-novels"],
		queryFn: getDownloadedNovels,
	});

	return {
		novels: query.data ?? [],
		isLoading: query.isLoading,
		refresh: () => {
			void query.refetch();
		},
	};
}

export function usePendingSyncCount(): number {
	const query = useQuery({
		queryKey: ["offline", "pending-sync-count"],
		queryFn: getPendingOpsCount,
		refetchInterval: 5000,
	});

	return query.data ?? 0;
}

export function usePendingEntityIds(): Set<string> {
	const query = useQuery({
		queryKey: ["offline", "pending-entity-ids"],
		queryFn: getPendingEntityIds,
		refetchInterval: 5000,
	});

	return query.data ?? new Set<string>();
}

export function useOfflineKeywords(novelId: string, search: string) {
	const [debouncedSearch] = useDebouncedValue(search.trim(), 300);
	const { downloadedIds } = useDownloadedNovelIds();
	const online = useOnlineStatus();
	const isDownloaded = downloadedIds.has(novelId);
	const useLocalCache = isDownloaded || !online;

	const offlineQuery = useQuery({
		queryKey: ["offline", "keywords", novelId],
		queryFn: () => getAssembledKeywordsByNovelId(novelId),
		enabled: useLocalCache,
	});

	const items = useMemo(() => {
		if (!useLocalCache) {
			return undefined;
		}

		const source = offlineQuery.data ?? [];
		return sortKeywords(filterBySearch(source, debouncedSearch));
	}, [useLocalCache, offlineQuery.data, debouncedSearch]);

	return {
		items,
		isDownloaded,
		useLocalCache,
		isLoading: useLocalCache ? offlineQuery.isLoading : false,
		isFetchingNextPage: false,
		loadMoreRef: undefined as React.RefObject<HTMLDivElement> | undefined,
	};
}

export function useOfflineKeywordAliases(keywordId: string | undefined) {
	const offlineQuery = useQuery({
		queryKey: ["offline", "keyword-aliases", keywordId],
		queryFn: () => (keywordId ? getAliasesByKeywordId(keywordId) : []),
		enabled: !!keywordId,
	});

	return {
		aliases: offlineQuery.data ?? [],
		isLoading: offlineQuery.isLoading,
	};
}

export function useOfflineReplacements(novelId: string, search: string) {
	const [debouncedSearch] = useDebouncedValue(search.trim(), 300);
	const { downloadedIds } = useDownloadedNovelIds();
	const online = useOnlineStatus();
	const isDownloaded = downloadedIds.has(novelId);
	const useLocalCache = isDownloaded || !online;

	const offlineQuery = useQuery({
		queryKey: ["offline", "replacements", novelId],
		queryFn: () => getReplacementsByNovelId(novelId),
		enabled: useLocalCache,
	});

	const items = useMemo(() => {
		if (!useLocalCache) {
			return undefined;
		}

		const source = offlineQuery.data ?? [];
		return sortReplacements(filterBySearch(source, debouncedSearch));
	}, [useLocalCache, offlineQuery.data, debouncedSearch]);

	return {
		items,
		isDownloaded,
		useLocalCache,
		isLoading: useLocalCache ? offlineQuery.isLoading : false,
		isFetchingNextPage: false,
		loadMoreRef: undefined as React.RefObject<HTMLDivElement> | undefined,
	};
}

export function useOfflineKeywordCategories(search = "") {
	const [debouncedSearch] = useDebouncedValue(search.trim(), 300);
	const online = useOnlineStatus();
	const queryClient = useQueryClient();
	const locale = useAtomValue(localeAtom);

	const offlineQuery = useQuery({
		queryKey: ["offline", "keyword-categories"],
		queryFn: getAllKeywordCategories,
	});

	const seedQuery = useQuery({
		queryKey: ["keyword-categories", "cache-seed", locale],
		queryFn: async () => {
			const data = await seedKeywordCategoriesCache(locale);
			await queryClient.invalidateQueries({
				queryKey: ["offline", "keyword-categories"],
			});
			return data;
		},
		enabled: online && (offlineQuery.data?.length ?? 0) === 0,
	});

	const data = useMemo(() => {
		const source = (
			offlineQuery.data?.length ? offlineQuery.data : (seedQuery.data ?? [])
		) as KeywordCategory[];
		return sortLookupByName(filterBySearch(source, debouncedSearch), locale);
	}, [offlineQuery.data, seedQuery.data, debouncedSearch, locale]);

	return {
		data,
		isLoading: offlineQuery.isLoading || seedQuery.isLoading,
	};
}

export function useOfflineKeywordNatures(search = "") {
	const [debouncedSearch] = useDebouncedValue(search.trim(), 300);
	const online = useOnlineStatus();
	const queryClient = useQueryClient();
	const locale = useAtomValue(localeAtom);

	const offlineQuery = useQuery({
		queryKey: ["offline", "keyword-natures"],
		queryFn: getAllKeywordNatures,
	});

	const seedQuery = useQuery({
		queryKey: ["keyword-natures", "cache-seed", locale],
		queryFn: async () => {
			const data = await seedKeywordNaturesCache(locale);
			await queryClient.invalidateQueries({
				queryKey: ["offline", "keyword-natures"],
			});
			return data;
		},
		enabled: online && (offlineQuery.data?.length ?? 0) === 0,
	});

	const data = useMemo(() => {
		const source = (
			offlineQuery.data?.length ? offlineQuery.data : (seedQuery.data ?? [])
		) as KeywordNature[];
		return sortLookupByName(filterBySearch(source, debouncedSearch), locale);
	}, [offlineQuery.data, seedQuery.data, debouncedSearch, locale]);

	return {
		data,
		isLoading: offlineQuery.isLoading || seedQuery.isLoading,
	};
}

async function queueOfflineOperation(
	entity: SyncEntity,
	action: SyncAction,
	entityId: string,
	novelId: string,
	payload: Record<string, unknown>,
): Promise<void> {
	const operation: SyncOperation = {
		id: crypto.randomUUID(),
		entity,
		action,
		entityId,
		novelId,
		payload,
		createdAt: Date.now(),
		status: "pending",
		retryCount: 0,
	};

	await addPendingOp(operation);
}

async function resolveKeywordLookups(
	categoryId: string,
	natureId: string,
): Promise<{ category: KeywordCategory; nature: KeywordNature }> {
	const categories = await getAllKeywordCategories();
	const natures = await getAllKeywordNatures();
	const category = categories.find((entry) => entry.id === categoryId);
	const nature = natures.find((entry) => entry.id === natureId);

	if (!category || !nature) {
		throw new Error("Category or nature not found in offline cache");
	}

	return { category, nature };
}

async function resolveKeywordLookupsOptional(
	categoryId: string | null | undefined,
	natureId: string | null | undefined,
): Promise<{ category: KeywordCategory | null; nature: KeywordNature | null }> {
	const [categories, natures] = await Promise.all([
		categoryId
			? getAllKeywordCategories()
			: Promise.resolve([] as KeywordCategory[]),
		natureId ? getAllKeywordNatures() : Promise.resolve([] as KeywordNature[]),
	]);
	return {
		category: categoryId
			? (categories.find((e) => e.id === categoryId) ?? null)
			: null,
		nature: natureId ? (natures.find((e) => e.id === natureId) ?? null) : null,
	};
}

async function ensureCatalogNovelCached(novelId: string): Promise<void> {
	const novel = await getCatalogNovelById(novelId);
	if (novel) {
		await saveCatalogNovel(novel);
	}
}

function invalidateOfflineQueries(
	queryClient: ReturnType<typeof useQueryClient>,
	entity: SyncEntity,
	scopeId: string,
): void {
	if (
		entity === "keyword" ||
		entity === "keywordAlias" ||
		entity === "keywordVersion"
	) {
		queryClient.invalidateQueries({
			queryKey: ["offline", "keywords", scopeId],
		});
		queryClient.invalidateQueries({ queryKey: ["keywords"] });
	} else if (entity === "replacement") {
		queryClient.invalidateQueries({
			queryKey: ["offline", "replacements", scopeId],
		});
		queryClient.invalidateQueries({ queryKey: ["replacements"] });
	} else if (entity === "keywordCategory") {
		queryClient.invalidateQueries({
			queryKey: ["offline", "keyword-categories"],
		});
		queryClient.invalidateQueries({ queryKey: ["keyword-categories"] });
	} else {
		queryClient.invalidateQueries({
			queryKey: ["offline", "keyword-natures"],
		});
		queryClient.invalidateQueries({ queryKey: ["keyword-natures"] });
	}

	queryClient.invalidateQueries({
		queryKey: ["offline", "pending-sync-count"],
	});
	queryClient.invalidateQueries({
		queryKey: ["offline", "pending-entity-ids"],
	});
}

export function useOfflineKeywordMutations(novelId: string) {
	const queryClient = useQueryClient();
	const online = useOnlineStatus();

	const invalidate = useCallback(() => {
		invalidateOfflineQueries(queryClient, "keyword", novelId);
		queryClient.invalidateQueries({ queryKey: ["keywords", novelId] });
	}, [queryClient, novelId]);

	const refreshPageHighlights = useCallback(async () => {
		await refreshContentScript();
	}, []);

	const createMutation = useMutation({
		mutationFn: async (values: PostKeywordsBodyOne) => {
			await ensureCatalogNovelCached(novelId);
			const tempId = createTempId();
			const now = new Date().toISOString();

			const { category, nature } = await resolveKeywordLookups(
				values.categoryId,
				values.natureId,
			);

			const keyword: OfflineKeyword = {
				id: tempId,
				name: values.name,
				matchingType: values.matchingType ?? "FULL",
				novelId,
				createdById: null,
				createdAt: now,
				updatedAt: now,
				aliases: [],
				versions: [],
				isDirty: !online,
			};
			await saveKeyword(keyword);

			// Persist default version locally (startingChapter=0)
			const tempVersionId = createTempId();
			const defaultVersion: OfflineKeywordVersion = {
				id: tempVersionId,
				keywordId: tempId,
				description: values.description ?? null,
				startingChapter: 0,
				endingChapter: null,
				categoryId: values.categoryId,
				natureId: values.natureId,
				imageId: values.imageId ?? null,
				createdById: null,
				createdAt: now,
				updatedAt: now,
				category,
				nature,
				image: null,
				isDirty: !online,
			};
			await saveKeywordVersion(defaultVersion);

			if (online) {
				runBackgroundSync(async () => {
					try {
						const response = await postKeywords(values);
						const returned = response.data as GetKeywords200DataItem;
						await deleteKeywordById(tempId); // cascades temp version
						await saveKeyword(
							cleanOfflineKeyword({ ...returned, aliases: [], versions: [] }),
						);
						for (const alias of returned.aliases) {
							await saveKeywordAlias(cleanOfflineKeywordAlias(alias));
						}
						for (const ver of returned.versions) {
							await saveKeywordVersion(cleanOfflineKeywordVersion(ver));
						}
					} catch {
						await markKeywordDirty(tempId);
						await queueOfflineOperation(
							"keyword",
							"create",
							tempId,
							novelId,
							values as unknown as Record<string, unknown>,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"keyword",
					"create",
					tempId,
					novelId,
					values as unknown as Record<string, unknown>,
				);
			}

			return keyword;
		},
		onSuccess: async () => {
			invalidate();
			await refreshPageHighlights();
		},
	});

	const updateMutation = useMutation({
		mutationFn: async ({
			id,
			data,
		}: {
			id: string;
			data: PutKeywordsByIdBodyOne;
		}) => {
			await ensureCatalogNovelCached(novelId);
			const existing = await getKeywordById(id);

			if (!existing && !online) {
				throw new Error("Keyword not found offline");
			}

			const updated: OfflineKeyword = {
				id,
				name: data.name ?? existing?.name ?? "",
				matchingType: data.matchingType ?? existing?.matchingType ?? "FULL",
				novelId,
				createdById: existing?.createdById ?? null,
				createdAt: existing?.createdAt ?? new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				aliases: existing?.aliases ?? [],
				versions: existing?.versions ?? [],
				isDirty: !online,
			};
			await saveKeyword(updated);

			if (online && !isTempId(id)) {
				runBackgroundSync(async () => {
					try {
						const response = await putKeywordsById(id, data);
						await saveKeyword(
							cleanOfflineKeyword({
								...(response.data as GetKeywords200DataItem),
								aliases: [],
								versions: [],
							}),
						);
					} catch {
						await markKeywordDirty(id);
						await queueOfflineOperation(
							"keyword",
							"update",
							id,
							novelId,
							data as unknown as Record<string, unknown>,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"keyword",
					"update",
					id,
					novelId,
					data as unknown as Record<string, unknown>,
				);
			}

			return updated;
		},
		onSuccess: async () => {
			invalidate();
			await refreshPageHighlights();
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			await deleteKeywordById(id); // cascades aliases and versions

			if (online) {
				runBackgroundSync(async () => {
					try {
						await deleteKeywordsById(id);
					} catch {
						await queueOfflineOperation("keyword", "delete", id, novelId, {});
					}
				}, invalidate);
			} else {
				await queueOfflineOperation("keyword", "delete", id, novelId, {});
			}
		},
		onSuccess: async () => {
			invalidate();
			await refreshPageHighlights();
		},
	});

	return { createMutation, updateMutation, deleteMutation };
}

export function useOfflineKeywordAliasMutations(novelId: string) {
	const queryClient = useQueryClient();
	const online = useOnlineStatus();

	const invalidate = useCallback(() => {
		invalidateOfflineQueries(queryClient, "keywordAlias", novelId);
		queryClient.invalidateQueries({ queryKey: ["keywords", novelId] });
	}, [queryClient, novelId]);

	const refreshPageHighlights = useCallback(async () => {
		await refreshContentScript();
	}, []);

	const createMutation = useMutation({
		mutationFn: async (values: PostKeywordAliasesBodyOne) => {
			await ensureCatalogNovelCached(novelId);
			const tempId = createTempId();
			const now = new Date().toISOString();

			const { category, nature } = await resolveKeywordLookupsOptional(
				values.categoryId,
				values.natureId,
			);

			const alias: OfflineKeywordAlias = {
				id: tempId,
				name: values.name,
				description: values.description ?? null,
				matchingType: values.matchingType ?? "FULL",
				overrideStyle: values.overrideStyle ?? false,
				categoryId: values.categoryId ?? null,
				natureId: values.natureId ?? null,
				imageId: values.imageId ?? null,
				image: null,
				keywordId: values.keywordId,
				createdById: null,
				createdAt: now,
				updatedAt: now,
				category: category,
				nature: nature,
				isDirty: !online,
			};
			await saveKeywordAlias(alias);

			if (online) {
				runBackgroundSync(async () => {
					try {
						const response = await postKeywordAliases(values);
						await deleteKeywordAliasById(tempId);
						await saveKeywordAlias(
							cleanOfflineKeywordAlias(
								response.data as GetKeywords200DataItemAliasesItem,
							),
						);
					} catch {
						await markKeywordAliasDirty(tempId);
						await queueOfflineOperation(
							"keywordAlias",
							"create",
							tempId,
							novelId,
							values as unknown as Record<string, unknown>,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"keywordAlias",
					"create",
					tempId,
					novelId,
					values as unknown as Record<string, unknown>,
				);
			}

			return alias;
		},
		onSuccess: async () => {
			invalidate();
			await refreshPageHighlights();
		},
	});

	const updateMutation = useMutation({
		mutationFn: async ({
			id,
			data,
		}: {
			id: string;
			data: PutKeywordAliasesByIdBodyOne;
		}) => {
			await ensureCatalogNovelCached(novelId);
			const existing = await getKeywordAliasById(id);

			if (!existing && !online) {
				throw new Error("Alias not found offline");
			}

			const effectiveCategoryId =
				data.categoryId !== undefined
					? data.categoryId
					: (existing?.categoryId ?? null);
			const effectiveNatureId =
				data.natureId !== undefined
					? data.natureId
					: (existing?.natureId ?? null);
			const { category, nature } = await resolveKeywordLookupsOptional(
				effectiveCategoryId,
				effectiveNatureId,
			);

			const effectiveImageId =
				data.imageId !== undefined ? data.imageId : (existing?.imageId ?? null);
			const updated: OfflineKeywordAlias = {
				id,
				name: data.name ?? existing?.name ?? "",
				description: data.description ?? existing?.description ?? null,
				matchingType: data.matchingType ?? existing?.matchingType ?? "FULL",
				overrideStyle: data.overrideStyle ?? existing?.overrideStyle ?? false,
				categoryId: effectiveCategoryId,
				natureId: effectiveNatureId,
				imageId: effectiveImageId,
				image: existing?.image ?? null,
				keywordId: existing?.keywordId ?? "",
				createdById: existing?.createdById ?? null,
				createdAt: existing?.createdAt ?? new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				category: category,
				nature: nature,
				isDirty: !online,
			};
			await saveKeywordAlias(updated);

			if (online && !isTempId(id)) {
				runBackgroundSync(async () => {
					try {
						const response = await putKeywordAliasesById(id, data);
						await saveKeywordAlias(
							cleanOfflineKeywordAlias(
								response.data as GetKeywords200DataItemAliasesItem,
							),
						);
					} catch {
						await markKeywordAliasDirty(id);
						await queueOfflineOperation(
							"keywordAlias",
							"update",
							id,
							novelId,
							data as unknown as Record<string, unknown>,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"keywordAlias",
					"update",
					id,
					novelId,
					data as unknown as Record<string, unknown>,
				);
			}

			return updated;
		},
		onSuccess: async () => {
			invalidate();
			await refreshPageHighlights();
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			await deleteKeywordAliasById(id);

			if (online) {
				runBackgroundSync(async () => {
					try {
						await deleteKeywordAliasesById(id);
					} catch {
						await queueOfflineOperation(
							"keywordAlias",
							"delete",
							id,
							novelId,
							{},
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation("keywordAlias", "delete", id, novelId, {});
			}
		},
		onSuccess: async () => {
			invalidate();
			await refreshPageHighlights();
		},
	});

	return { createMutation, updateMutation, deleteMutation };
}

export function useOfflineKeywordVersionMutations(novelId: string) {
	const queryClient = useQueryClient();
	const online = useOnlineStatus();

	const invalidate = useCallback(() => {
		invalidateOfflineQueries(queryClient, "keywordVersion", novelId);
		queryClient.invalidateQueries({ queryKey: ["keywords", novelId] });
	}, [queryClient, novelId]);

	const refreshPageHighlights = useCallback(async () => {
		await refreshContentScript();
	}, []);

	const createMutation = useMutation({
		mutationFn: async (values: PostKeywordVersionsBodyOne) => {
			await ensureCatalogNovelCached(novelId);
			const tempId = createTempId();
			const now = new Date().toISOString();

			const localStartingChapter =
				values.startingChapter ?? values.currentChapter ?? 0;
			const { category, nature } =
				values.categoryId && values.natureId
					? await resolveKeywordLookups(values.categoryId, values.natureId)
					: await resolveKeywordLookupsOptional(
							values.categoryId,
							values.natureId,
						);

			const version: OfflineKeywordVersion = {
				id: tempId,
				keywordId: values.keywordId,
				description: values.description ?? null,
				startingChapter: localStartingChapter,
				endingChapter: values.endingChapter ?? null,
				categoryId: values.categoryId ?? null,
				natureId: values.natureId ?? null,
				imageId: values.imageId ?? null,
				createdById: null,
				createdAt: now,
				updatedAt: now,
				category: category,
				nature: nature,
				image: null,
				isDirty: !online,
			};
			await saveKeywordVersion(version);

			// Close previous open-ended version locally for immediate UI feedback
			const existingVersions = await getVersionsByKeywordId(values.keywordId);
			const prevOpen = existingVersions.find(
				(v) =>
					v.id !== tempId &&
					v.endingChapter === null &&
					Number(v.startingChapter) < localStartingChapter,
			);
			if (prevOpen) {
				await saveKeywordVersion({
					...prevOpen,
					endingChapter: localStartingChapter - 1,
				});
			}

			if (online) {
				runBackgroundSync(async () => {
					try {
						const response = await postKeywordVersions(values);
						await deleteKeywordVersionById(tempId);
						await saveKeywordVersion(
							cleanOfflineKeywordVersion(
								response.data as GetKeywords200DataItemVersionsItem,
							),
						);
					} catch {
						await markKeywordVersionDirty(tempId);
						await queueOfflineOperation(
							"keywordVersion",
							"create",
							tempId,
							novelId,
							values as unknown as Record<string, unknown>,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"keywordVersion",
					"create",
					tempId,
					novelId,
					values as unknown as Record<string, unknown>,
				);
			}

			return version;
		},
		onSuccess: async () => {
			invalidate();
			await refreshPageHighlights();
		},
	});

	const updateMutation = useMutation({
		mutationFn: async ({
			id,
			data,
		}: {
			id: string;
			data: PutKeywordVersionsByIdBodyOne;
		}) => {
			await ensureCatalogNovelCached(novelId);
			const existing = await getKeywordVersionById(id);

			if (!existing && !online) {
				throw new Error("Version not found offline");
			}

			const effectiveCategoryId =
				data.categoryId !== undefined
					? data.categoryId
					: (existing?.categoryId ?? null);
			const effectiveNatureId =
				data.natureId !== undefined
					? data.natureId
					: (existing?.natureId ?? null);
			const { category, nature } =
				effectiveCategoryId && effectiveNatureId
					? await resolveKeywordLookups(effectiveCategoryId, effectiveNatureId)
					: await resolveKeywordLookupsOptional(
							effectiveCategoryId,
							effectiveNatureId,
						);

			const updated: OfflineKeywordVersion = {
				id,
				keywordId: existing?.keywordId ?? "",
				description: data.description ?? existing?.description ?? null,
				startingChapter: data.startingChapter ?? existing?.startingChapter ?? 0,
				endingChapter:
					data.endingChapter !== undefined
						? data.endingChapter
						: (existing?.endingChapter ?? null),
				categoryId: effectiveCategoryId,
				natureId: effectiveNatureId,
				imageId: data.imageId ?? existing?.imageId ?? null,
				createdById: existing?.createdById ?? null,
				createdAt: existing?.createdAt ?? new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				category: category,
				nature: nature,
				image: existing?.image ?? null,
				isDirty: !online,
			};
			await saveKeywordVersion(updated);

			if (online && !isTempId(id)) {
				runBackgroundSync(async () => {
					try {
						const response = await putKeywordVersionsById(id, data);
						await saveKeywordVersion(
							cleanOfflineKeywordVersion(
								response.data as GetKeywords200DataItemVersionsItem,
							),
						);
					} catch {
						await markKeywordVersionDirty(id);
						await queueOfflineOperation(
							"keywordVersion",
							"update",
							id,
							novelId,
							data as unknown as Record<string, unknown>,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"keywordVersion",
					"update",
					id,
					novelId,
					data as unknown as Record<string, unknown>,
				);
			}

			return updated;
		},
		onSuccess: async () => {
			invalidate();
			await refreshPageHighlights();
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			const version = await getKeywordVersionById(id);
			if (version) {
				const versions = await getVersionsByKeywordId(version.keywordId);
				if (versions.length <= 1) {
					throw new Error("Cannot delete the only version of a keyword");
				}
				const baseVersion = [...versions].sort(
					(a, b) => Number(a.startingChapter) - Number(b.startingChapter),
				)[0];
				if (baseVersion?.id === id) {
					throw new Error("Cannot delete the base version of a keyword");
				}
			}

			await deleteKeywordVersionById(id);

			if (online) {
				runBackgroundSync(async () => {
					try {
						await deleteKeywordVersionsById(id);
					} catch {
						await queueOfflineOperation(
							"keywordVersion",
							"delete",
							id,
							novelId,
							{},
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"keywordVersion",
					"delete",
					id,
					novelId,
					{},
				);
			}
		},
		onSuccess: async () => {
			invalidate();
			await refreshPageHighlights();
		},
	});

	return { createMutation, updateMutation, deleteMutation };
}

export function useOfflineReplacementMutations(novelId: string) {
	const queryClient = useQueryClient();
	const online = useOnlineStatus();

	const invalidate = useCallback(() => {
		invalidateOfflineQueries(queryClient, "replacement", novelId);
		queryClient.invalidateQueries({ queryKey: ["replacements", novelId] });
	}, [queryClient, novelId]);

	const refreshPageHighlights = useCallback(async () => {
		await refreshContentScript();
	}, []);

	const createMutation = useMutation({
		mutationFn: async (values: PostReplacementsBodyOne) => {
			await ensureCatalogNovelCached(novelId);

			const tempId = createTempId();
			const replacement: OfflineReplacement = {
				id: tempId,
				from: values.from,
				to: values.to,
				matchingType: values.matchingType ?? "FULL",
				novelId,
				keywordId: null,
				createdById: null,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				keyword: null,
				isDirty: !online,
			};

			await saveReplacement(replacement);

			if (online) {
				runBackgroundSync(async () => {
					try {
						const response = await postReplacements(values);
						await deleteReplacementById(tempId);
						await saveReplacement(cleanOfflineReplacement(response.data));
					} catch {
						await markReplacementDirty(tempId);
						await queueOfflineOperation(
							"replacement",
							"create",
							tempId,
							novelId,
							values as unknown as Record<string, unknown>,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"replacement",
					"create",
					tempId,
					novelId,
					values as unknown as Record<string, unknown>,
				);
			}

			return replacement;
		},
		onSuccess: async () => {
			invalidate();
			await refreshPageHighlights();
		},
	});

	const updateMutation = useMutation({
		mutationFn: async ({
			id,
			data,
		}: {
			id: string;
			data: PutReplacementsByIdBodyOne;
		}) => {
			await ensureCatalogNovelCached(novelId);
			const existing = (await getReplacementsByNovelId(novelId)).find(
				(entry) => entry.id === id,
			);

			if (!existing && !online) {
				throw new Error("Replacement not found offline");
			}

			const updated: OfflineReplacement = {
				id,
				from: data.from ?? existing?.from ?? "",
				to: data.to ?? existing?.to ?? "",
				matchingType: data.matchingType ?? existing?.matchingType ?? "FULL",
				novelId,
				keywordId: existing?.keywordId ?? null,
				createdById: existing?.createdById ?? null,
				createdAt: existing?.createdAt ?? new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				keyword: existing?.keyword ?? null,
				isDirty: !online,
			};

			await saveReplacement(updated);

			if (online) {
				runBackgroundSync(async () => {
					try {
						const response = await putReplacementsById(id, data);
						await saveReplacement(cleanOfflineReplacement(response.data));
					} catch {
						await markReplacementDirty(id);
						await queueOfflineOperation(
							"replacement",
							"update",
							id,
							novelId,
							data as unknown as Record<string, unknown>,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"replacement",
					"update",
					id,
					novelId,
					data as unknown as Record<string, unknown>,
				);
			}

			return updated;
		},
		onSuccess: async () => {
			invalidate();
			await refreshPageHighlights();
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			await ensureCatalogNovelCached(novelId);
			await deleteReplacementById(id);

			if (online) {
				runBackgroundSync(async () => {
					try {
						await deleteReplacementsById(id);
					} catch {
						await queueOfflineOperation(
							"replacement",
							"delete",
							id,
							novelId,
							{},
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation("replacement", "delete", id, novelId, {});
			}
		},
		onSuccess: async () => {
			invalidate();
			await refreshPageHighlights();
		},
	});

	return { createMutation, updateMutation, deleteMutation };
}

export type CategoryFormValues = PostKeywordCategoriesBodyOne;

export type NatureFormValues = PostKeywordNaturesBodyOne;

export function useOfflineCategoryMutations() {
	const queryClient = useQueryClient();
	const online = useOnlineStatus();

	const invalidate = useCallback(() => {
		invalidateOfflineQueries(
			queryClient,
			"keywordCategory",
			GLOBAL_LOOKUP_SCOPE,
		);
	}, [queryClient]);

	const createMutation = useMutation({
		mutationFn: async (values: CategoryFormValues) => {
			const tempId = createTempId();
			const category: KeywordCategory = {
				id: tempId,
				nameEn: values.nameEn ?? null,
				nameAr: values.nameAr ?? null,
				color: values.color,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			await saveKeywordCategory(category);

			if (online) {
				runBackgroundSync(async () => {
					try {
						const response = await postKeywordCategories({
							nameEn: values.nameEn,
							nameAr: values.nameAr,
							color: values.color,
						});
						const saved = response.data as KeywordCategory;
						await deleteKeywordCategoryById(tempId);
						await saveKeywordCategory(saved);
					} catch {
						await queueOfflineOperation(
							"keywordCategory",
							"create",
							tempId,
							GLOBAL_LOOKUP_SCOPE,
							values as unknown as Record<string, unknown>,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"keywordCategory",
					"create",
					tempId,
					GLOBAL_LOOKUP_SCOPE,
					values as unknown as Record<string, unknown>,
				);
			}

			return category;
		},
		onSuccess: () => invalidate(),
	});

	const updateMutation = useMutation({
		mutationFn: async ({
			id,
			data,
		}: {
			id: string;
			data: CategoryFormValues;
		}) => {
			const existing = (await getAllKeywordCategories()).find(
				(entry) => entry.id === id,
			);
			if (!existing) {
				throw new Error("Category not found offline");
			}

			const updated: KeywordCategory = {
				...existing,
				...data,
				updatedAt: new Date().toISOString(),
			};
			await saveKeywordCategory(updated);
			await updateKeywordCategoryReferences(updated);

			if (online) {
				runBackgroundSync(async () => {
					try {
						const response = await putKeywordCategoriesById(id, {
							nameEn: data.nameEn,
							nameAr: data.nameAr,
							color: data.color,
						});
						const saved = response.data as KeywordCategory;
						await saveKeywordCategory(saved);
						await updateKeywordCategoryReferences(saved);
					} catch {
						await queueOfflineOperation(
							"keywordCategory",
							"update",
							id,
							GLOBAL_LOOKUP_SCOPE,
							data as unknown as Record<string, unknown>,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"keywordCategory",
					"update",
					id,
					GLOBAL_LOOKUP_SCOPE,
					data as unknown as Record<string, unknown>,
				);
			}

			return updated;
		},
		onSuccess: () => invalidate(),
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			await deleteKeywordCategoryById(id);

			if (online) {
				runBackgroundSync(async () => {
					try {
						await deleteKeywordCategoriesById(id);
					} catch {
						await queueOfflineOperation(
							"keywordCategory",
							"delete",
							id,
							GLOBAL_LOOKUP_SCOPE,
							{},
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"keywordCategory",
					"delete",
					id,
					GLOBAL_LOOKUP_SCOPE,
					{},
				);
			}
		},
		onSuccess: () => invalidate(),
	});

	return { createMutation, updateMutation, deleteMutation };
}

export function useOfflineNatureMutations() {
	const queryClient = useQueryClient();
	const online = useOnlineStatus();

	const invalidate = useCallback(() => {
		invalidateOfflineQueries(queryClient, "keywordNature", GLOBAL_LOOKUP_SCOPE);
	}, [queryClient]);

	const createMutation = useMutation({
		mutationFn: async (values: NatureFormValues) => {
			const tempId = createTempId();
			const nature: KeywordNature = {
				id: tempId,
				nameEn: values.nameEn ?? null,
				nameAr: values.nameAr ?? null,
				color: values.color,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			await saveKeywordNature(nature);

			if (online) {
				runBackgroundSync(async () => {
					try {
						const response = await postKeywordNatures({
							nameEn: values.nameEn,
							nameAr: values.nameAr,
							color: values.color,
						});
						const saved = response.data as KeywordNature;
						await deleteKeywordNatureById(tempId);
						await saveKeywordNature(saved);
					} catch {
						await queueOfflineOperation(
							"keywordNature",
							"create",
							tempId,
							GLOBAL_LOOKUP_SCOPE,
							values as unknown as Record<string, unknown>,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"keywordNature",
					"create",
					tempId,
					GLOBAL_LOOKUP_SCOPE,
					values as unknown as Record<string, unknown>,
				);
			}

			return nature;
		},
		onSuccess: () => invalidate(),
	});

	const updateMutation = useMutation({
		mutationFn: async ({
			id,
			data,
		}: {
			id: string;
			data: NatureFormValues;
		}) => {
			const existing = (await getAllKeywordNatures()).find(
				(entry) => entry.id === id,
			);
			if (!existing) {
				throw new Error("Nature not found offline");
			}

			const updated: KeywordNature = {
				...existing,
				...data,
				updatedAt: new Date().toISOString(),
			};
			await saveKeywordNature(updated);
			await updateKeywordNatureReferences(updated);

			if (online) {
				runBackgroundSync(async () => {
					try {
						const response = await putKeywordNaturesById(id, {
							nameEn: data.nameEn,
							nameAr: data.nameAr,
							color: data.color,
						});
						const saved = response.data as KeywordNature;
						await saveKeywordNature(saved);
						await updateKeywordNatureReferences(saved);
					} catch {
						await queueOfflineOperation(
							"keywordNature",
							"update",
							id,
							GLOBAL_LOOKUP_SCOPE,
							data as unknown as Record<string, unknown>,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"keywordNature",
					"update",
					id,
					GLOBAL_LOOKUP_SCOPE,
					data as unknown as Record<string, unknown>,
				);
			}

			return updated;
		},
		onSuccess: () => invalidate(),
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			await deleteKeywordNatureById(id);

			if (online) {
				runBackgroundSync(async () => {
					try {
						await deleteKeywordNaturesById(id);
					} catch {
						await queueOfflineOperation(
							"keywordNature",
							"delete",
							id,
							GLOBAL_LOOKUP_SCOPE,
							{},
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"keywordNature",
					"delete",
					id,
					GLOBAL_LOOKUP_SCOPE,
					{},
				);
			}
		},
		onSuccess: () => invalidate(),
	});

	return { createMutation, updateMutation, deleteMutation };
}
