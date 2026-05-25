import { useDebouncedValue } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
	deleteKeywordsById,
	postKeywords,
	putKeywordsById,
} from "@/api/generated/endpoints/keywords.js";
import {
	deleteReplacementsById,
	postReplacements,
	putReplacementsById,
} from "@/api/generated/endpoints/replacements.js";
import type {
	GetKeywordCategories200DataItem,
	GetKeywordNatures200DataItem,
	GetKeywords200DataItem,
	GetReplacements200DataItem,
	PostKeywordCategoriesBodyOne,
	PostKeywordNaturesBodyOne,
	PostKeywordsBodyOne,
	PostReplacementsBodyOne,
	PutKeywordCategoriesByIdBodyOne,
	PutKeywordNaturesByIdBodyOne,
	PutKeywordsByIdBodyOne,
	PutReplacementsByIdBodyOne,
} from "@/api/generated/schemas";
import { withBackgroundSync } from "@/lib/offline/background-sync";
import {
	bulkPutKeywordCategories,
	bulkPutKeywordNatures,
	deleteKeywordById,
	deleteKeywordCategoryById,
	deleteKeywordNatureById,
	deleteReplacementById,
	getAllCatalogNovels,
	getAllKeywordCategories,
	getAllKeywordNatures,
	getCatalogNovelById,
	getDownloadedNovels,
	getKeywordsByNovelId,
	getReplacementsByNovelId,
	markKeywordDirty,
	markReplacementDirty,
	saveCatalogNovel,
	saveKeyword,
	saveKeywordCategory,
	saveKeywordNature,
	saveReplacement,
	updateKeywordCategoryReferences,
	updateKeywordNatureReferences,
} from "@/lib/offline/db";
import { isOnline, subscribeOnlineStatus } from "@/lib/offline/online-status";
import { refreshNovelsCatalog } from "@/lib/offline/seed-novels-catalog";
import { useActiveSyncCount } from "@/store/sync-status";
import {
	addPendingOp,
	getDownloadedNovelIds,
	getPendingEntityIds,
	getPendingOpsCount,
} from "@/lib/offline/sync-storage";
import type { CatalogNovel, DownloadedNovel, OfflineKeyword, OfflineReplacement } from "@/lib/offline/types";
import {
	cleanOfflineKeyword,
	cleanOfflineReplacement,
	createTempId,
	GLOBAL_LOOKUP_SCOPE,
	type SyncAction,
	type SyncEntity,
	type SyncOperation,
} from "@/lib/offline/types";
import type { KeywordCategory, KeywordNature } from "@/types/models";
import { withListQueryParams } from "@/utils/api-list-params";
import { refreshContentScript } from "@/utils/refresh-content-script";

function filterBySearch<
	T extends { name?: string; from?: string; to?: string },
>(items: T[], search: string): T[] {
	const term = search.trim().toLowerCase();
	if (!term) {
		return items;
	}

	return items.filter((item) => {
		const values = [item.name, item.from, item.to].filter(Boolean);
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

function sortLookupByName<T extends { name: string }>(items: T[]): T[] {
	return [...items].sort((left, right) => left.name.localeCompare(right.name));
}

async function seedKeywordCategoriesCache(): Promise<KeywordCategory[]> {
	const response = await getKeywordCategories(
		withListQueryParams({
			pagination: { page: 1, pageSize: 500 },
			sorting: { column: "name", direction: "asc" },
		}),
	);
	const data = response.data.data as KeywordCategory[];
	await bulkPutKeywordCategories(data);
	return data;
}

async function seedKeywordNaturesCache(): Promise<KeywordNature[]> {
	const response = await getKeywordNatures(
		withListQueryParams({
			pagination: { page: 1, pageSize: 500 },
			sorting: { column: "name", direction: "asc" },
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
		queryFn: () => getKeywordsByNovelId(novelId),
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

	const offlineQuery = useQuery({
		queryKey: ["offline", "keyword-categories"],
		queryFn: getAllKeywordCategories,
	});

	const seedQuery = useQuery({
		queryKey: ["keyword-categories", "cache-seed"],
		queryFn: async () => {
			const data = await seedKeywordCategoriesCache();
			await queryClient.invalidateQueries({
				queryKey: ["offline", "keyword-categories"],
			});
			return data;
		},
		enabled: online && (offlineQuery.data?.length ?? 0) === 0,
	});

	const data = useMemo(() => {
		const source = offlineQuery.data?.length
			? offlineQuery.data
			: (seedQuery.data ?? []);
		return sortLookupByName(filterBySearch(source, debouncedSearch));
	}, [offlineQuery.data, seedQuery.data, debouncedSearch]);

	return {
		data,
		isLoading: offlineQuery.isLoading || seedQuery.isLoading,
	};
}

export function useOfflineKeywordNatures(search = "") {
	const [debouncedSearch] = useDebouncedValue(search.trim(), 300);
	const online = useOnlineStatus();
	const queryClient = useQueryClient();

	const offlineQuery = useQuery({
		queryKey: ["offline", "keyword-natures"],
		queryFn: getAllKeywordNatures,
	});

	const seedQuery = useQuery({
		queryKey: ["keyword-natures", "cache-seed"],
		queryFn: async () => {
			const data = await seedKeywordNaturesCache();
			await queryClient.invalidateQueries({
				queryKey: ["offline", "keyword-natures"],
			});
			return data;
		},
		enabled: online && (offlineQuery.data?.length ?? 0) === 0,
	});

	const data = useMemo(() => {
		const source = offlineQuery.data?.length
			? offlineQuery.data
			: (seedQuery.data ?? []);
		return sortLookupByName(filterBySearch(source, debouncedSearch));
	}, [offlineQuery.data, seedQuery.data, debouncedSearch]);

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
	if (entity === "keyword") {
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
			const { category, nature } = await resolveKeywordLookups(
				values.categoryId,
				values.natureId,
			);
			await ensureCatalogNovelCached(novelId);

			const tempId = createTempId();
			const keyword: OfflineKeyword = {
				id: tempId,
				name: values.name,
				description: values.description,
				matchingType: values.matchingType ?? "FULL",
				categoryId: values.categoryId,
				natureId: values.natureId,
				imageId: values.imageId ?? null,
				parentId: null,
				novelId,
				createdById: null,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				category,
				nature,
				image: null,
				parent: null,
				isDirty: !online,
			};

			await saveKeyword(keyword);

			if (online) {
				runBackgroundSync(async () => {
					try {
						const response = await postKeywords(values);
						await deleteKeywordById(tempId);
						await saveKeyword(
							cleanOfflineKeyword(response.data as GetKeywords200DataItem),
						);
					} catch {
						await markKeywordDirty(tempId);
						await queueOfflineOperation(
							"keyword",
							"create",
							tempId,
							novelId,
							values,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation("keyword", "create", tempId, novelId, values);
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
			const existing = (await getKeywordsByNovelId(novelId)).find(
				(entry) => entry.id === id,
			);

			if (!existing && !online) {
				throw new Error("Keyword not found offline");
			}

			let category = existing?.category;
			let nature = existing?.nature;
			if (data.categoryId && data.categoryId !== existing?.categoryId) {
				category = (await getAllKeywordCategories()).find(
					(entry) => entry.id === data.categoryId,
				);
			}
			if (data.natureId && data.natureId !== existing?.natureId) {
				nature = (await getAllKeywordNatures()).find(
					(entry) => entry.id === data.natureId,
				);
			}

			if (!category || !nature) {
				const lookups = await resolveKeywordLookups(
					data.categoryId ?? existing?.categoryId ?? "",
					data.natureId ?? existing?.natureId ?? "",
				);
				category = lookups.category;
				nature = lookups.nature;
			}

			const updated: OfflineKeyword = {
				id,
				name: data.name ?? existing?.name ?? "",
				description: data.description ?? existing?.description ?? "",
				matchingType: data.matchingType ?? existing?.matchingType ?? "FULL",
				categoryId: data.categoryId ?? existing?.categoryId ?? "",
				natureId: data.natureId ?? existing?.natureId ?? "",
				imageId: data.imageId ?? existing?.imageId ?? null,
				parentId: existing?.parentId ?? null,
				novelId,
				createdById: existing?.createdById ?? null,
				createdAt: existing?.createdAt ?? new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				category,
				nature,
				image: existing?.image ?? null,
				parent: existing?.parent ?? null,
				isDirty: !online,
			};

			await saveKeyword(updated);

			if (online) {
				runBackgroundSync(async () => {
					try {
						const response = await putKeywordsById(id, data);
						await saveKeyword(
							cleanOfflineKeyword(response.data as GetKeywords200DataItem),
						);
					} catch {
						await markKeywordDirty(id);
						await queueOfflineOperation("keyword", "update", id, novelId, data);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation("keyword", "update", id, novelId, data);
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
			await deleteKeywordById(id);

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
							values,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"replacement",
					"create",
					tempId,
					novelId,
					values,
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
							data,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation("replacement", "update", id, novelId, data);
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
						await queueOfflineOperation("replacement", "delete", id, novelId, {});
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
		mutationFn: async (values: PostKeywordCategoriesBodyOne) => {
			const tempId = createTempId();
			const category: GetKeywordCategories200DataItem = {
				id: tempId,
				name: values.name,
				color: values.color,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			await saveKeywordCategory(category);

			if (online) {
				runBackgroundSync(async () => {
					try {
						const response = await postKeywordCategories(values);
						await deleteKeywordCategoryById(tempId);
						await saveKeywordCategory(
							response.data as GetKeywordCategories200DataItem,
						);
					} catch {
						await queueOfflineOperation(
							"keywordCategory",
							"create",
							tempId,
							GLOBAL_LOOKUP_SCOPE,
							values,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"keywordCategory",
					"create",
					tempId,
					GLOBAL_LOOKUP_SCOPE,
					values,
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
			data: PutKeywordCategoriesByIdBodyOne;
		}) => {
			const existing = (await getAllKeywordCategories()).find(
				(entry) => entry.id === id,
			);
			if (!existing) {
				throw new Error("Category not found offline");
			}

			const updated: GetKeywordCategories200DataItem = {
				...existing,
				...data,
				updatedAt: new Date().toISOString(),
			};
			await saveKeywordCategory(updated);
			await updateKeywordCategoryReferences(updated);

			if (online) {
				runBackgroundSync(async () => {
					try {
						const response = await putKeywordCategoriesById(id, data);
						await saveKeywordCategory(
							response.data as GetKeywordCategories200DataItem,
						);
						await updateKeywordCategoryReferences(
							response.data as GetKeywordCategories200DataItem,
						);
					} catch {
						await queueOfflineOperation(
							"keywordCategory",
							"update",
							id,
							GLOBAL_LOOKUP_SCOPE,
							data,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"keywordCategory",
					"update",
					id,
					GLOBAL_LOOKUP_SCOPE,
					data,
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
		mutationFn: async (values: PostKeywordNaturesBodyOne) => {
			const tempId = createTempId();
			const nature: GetKeywordNatures200DataItem = {
				id: tempId,
				name: values.name,
				color: values.color,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			await saveKeywordNature(nature);

			if (online) {
				runBackgroundSync(async () => {
					try {
						const response = await postKeywordNatures(values);
						await deleteKeywordNatureById(tempId);
						await saveKeywordNature(
							response.data as GetKeywordNatures200DataItem,
						);
					} catch {
						await queueOfflineOperation(
							"keywordNature",
							"create",
							tempId,
							GLOBAL_LOOKUP_SCOPE,
							values,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"keywordNature",
					"create",
					tempId,
					GLOBAL_LOOKUP_SCOPE,
					values,
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
			data: PutKeywordNaturesByIdBodyOne;
		}) => {
			const existing = (await getAllKeywordNatures()).find(
				(entry) => entry.id === id,
			);
			if (!existing) {
				throw new Error("Nature not found offline");
			}

			const updated: GetKeywordNatures200DataItem = {
				...existing,
				...data,
				updatedAt: new Date().toISOString(),
			};
			await saveKeywordNature(updated);
			await updateKeywordNatureReferences(updated);

			if (online) {
				runBackgroundSync(async () => {
					try {
						const response = await putKeywordNaturesById(id, data);
						await saveKeywordNature(
							response.data as GetKeywordNatures200DataItem,
						);
						await updateKeywordNatureReferences(
							response.data as GetKeywordNatures200DataItem,
						);
					} catch {
						await queueOfflineOperation(
							"keywordNature",
							"update",
							id,
							GLOBAL_LOOKUP_SCOPE,
							data,
						);
					}
				}, invalidate);
			} else {
				await queueOfflineOperation(
					"keywordNature",
					"update",
					id,
					GLOBAL_LOOKUP_SCOPE,
					data,
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
