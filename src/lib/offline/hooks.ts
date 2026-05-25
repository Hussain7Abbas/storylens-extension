import { useDebouncedValue } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	deleteKeywordCategoriesById,
	getKeywordCategories,
	postKeywordCategories,
	putKeywordCategoriesById,
} from "@/api/endpoints/keyword-categories.js";
import {
	deleteKeywordNaturesById,
	getKeywordNatures,
	postKeywordNatures,
	putKeywordNaturesById,
} from "@/api/endpoints/keyword-natures.js";
import {
	deleteKeywordsById,
	postKeywords,
	putKeywordsById,
} from "@/api/endpoints/keywords.js";
import {
	deleteReplacementsById,
	postReplacements,
	putReplacementsById,
} from "@/api/endpoints/replacements.js";
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
} from "@/api/schemas";
import {
	bulkPutKeywordCategories,
	bulkPutKeywordNatures,
	deleteKeywordById,
	deleteKeywordCategoryById,
	deleteKeywordNatureById,
	deleteReplacementById,
	getAllKeywordCategories,
	getAllKeywordNatures,
	getDownloadedNovels,
	getKeywordsByNovelId,
	getReplacementsByNovelId,
	isNovelDownloaded,
	saveKeyword,
	saveKeywordCategory,
	saveKeywordNature,
	saveReplacement,
	updateKeywordCategoryReferences,
	updateKeywordNatureReferences,
} from "@/lib/offline/db";
import type { DownloadedNovel } from "@/lib/offline/types";
import { isOnline, subscribeOnlineStatus } from "@/lib/offline/online-status";
import {
	addPendingOp,
	getDownloadedNovelIds,
	getPendingEntityIds,
	getPendingOpsCount,
} from "@/lib/offline/sync-storage";
import {
	createTempId,
	GLOBAL_LOOKUP_SCOPE,
	type SyncAction,
	type SyncEntity,
	type SyncOperation,
} from "@/lib/offline/types";
import type { KeywordCategory, KeywordNature } from "@/types/models";
import { withListQueryParams } from "@/utils/api-list-params";

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

function sortLookupByName<
	T extends { name: string },
>(items: T[]): T[] {
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

async function hasKeywordCategoriesCache(): Promise<boolean> {
	return (await getAllKeywordCategories()).length > 0;
}

async function hasKeywordNaturesCache(): Promise<boolean> {
	return (await getAllKeywordNatures()).length > 0;
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
	const isDownloaded = downloadedIds.has(novelId);

	const offlineQuery = useQuery({
		queryKey: ["offline", "keywords", novelId],
		queryFn: () => getKeywordsByNovelId(novelId),
		enabled: isDownloaded,
	});

	const items = useMemo(() => {
		if (!isDownloaded) {
			return undefined;
		}

		const source = offlineQuery.data ?? [];
		return sortKeywords(filterBySearch(source, debouncedSearch));
	}, [isDownloaded, offlineQuery.data, debouncedSearch]);

	return {
		items,
		isDownloaded,
		isLoading: isDownloaded ? offlineQuery.isLoading : false,
		isFetchingNextPage: false,
		loadMoreRef: undefined as React.RefObject<HTMLDivElement> | undefined,
	};
}

export function useOfflineReplacements(novelId: string, search: string) {
	const [debouncedSearch] = useDebouncedValue(search.trim(), 300);
	const { downloadedIds } = useDownloadedNovelIds();
	const isDownloaded = downloadedIds.has(novelId);

	const offlineQuery = useQuery({
		queryKey: ["offline", "replacements", novelId],
		queryFn: () => getReplacementsByNovelId(novelId),
		enabled: isDownloaded,
	});

	const items = useMemo(() => {
		if (!isDownloaded) {
			return undefined;
		}

		const source = offlineQuery.data ?? [];
		return sortReplacements(filterBySearch(source, debouncedSearch));
	}, [isDownloaded, offlineQuery.data, debouncedSearch]);

	return {
		items,
		isDownloaded,
		isLoading: isDownloaded ? offlineQuery.isLoading : false,
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
	}, [queryClient, novelId]);

	const createMutation = useMutation({
		mutationFn: async (values: PostKeywordsBodyOne) => {
			const downloaded = await isNovelDownloaded(novelId);
			if (!downloaded) {
				const response = await postKeywords(values);
				return response.data;
			}

			const tempId = createTempId();
			const categories = await getAllKeywordCategories();
			const natures = await getAllKeywordNatures();
			const category = categories.find(
				(entry) => entry.id === values.categoryId,
			);
			const nature = natures.find((entry) => entry.id === values.natureId);

			if (!category || !nature) {
				throw new Error("Category or nature not found in offline cache");
			}

			const keyword: GetKeywords200DataItem = {
				id: tempId,
				name: values.name,
				description: values.description,
				categoryId: values.categoryId,
				natureId: values.natureId,
				imageId: values.imageId ?? null,
				parentId: null,
				novelId,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				category,
				nature,
				image: null,
				parent: null,
			};

			await saveKeyword(keyword);

			if (online) {
				try {
					const response = await postKeywords(values);
					await deleteKeywordById(tempId);
					await saveKeyword(response.data as GetKeywords200DataItem);
					return response.data;
				} catch {
					await queueOfflineOperation(
						"keyword",
						"create",
						tempId,
						novelId,
						values,
					);
					return keyword;
				}
			}

			await queueOfflineOperation("keyword", "create", tempId, novelId, values);
			return keyword;
		},
		onSuccess: () => invalidate(),
	});

	const updateMutation = useMutation({
		mutationFn: async ({
			id,
			data,
		}: {
			id: string;
			data: PutKeywordsByIdBodyOne;
		}) => {
			const downloaded = await isNovelDownloaded(novelId);
			if (!downloaded) {
				const response = await putKeywordsById(id, data);
				return response.data;
			}

			const existing = (await getKeywordsByNovelId(novelId)).find(
				(entry) => entry.id === id,
			);
			if (!existing) {
				throw new Error("Keyword not found offline");
			}

			const updated: GetKeywords200DataItem = {
				...existing,
				...data,
				updatedAt: new Date().toISOString(),
			};
			await saveKeyword(updated);

			if (online) {
				try {
					const response = await putKeywordsById(id, data);
					await saveKeyword(response.data as GetKeywords200DataItem);
					return response.data;
				} catch {
					await queueOfflineOperation("keyword", "update", id, novelId, data);
					return updated;
				}
			}

			await queueOfflineOperation("keyword", "update", id, novelId, data);
			return updated;
		},
		onSuccess: () => invalidate(),
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			const downloaded = await isNovelDownloaded(novelId);
			if (!downloaded) {
				return deleteKeywordsById(id);
			}

			await deleteKeywordById(id);

			if (online) {
				try {
					return await deleteKeywordsById(id);
				} catch {
					await queueOfflineOperation("keyword", "delete", id, novelId, {});
				}
			} else {
				await queueOfflineOperation("keyword", "delete", id, novelId, {});
			}
		},
		onSuccess: () => invalidate(),
	});

	return { createMutation, updateMutation, deleteMutation };
}

export function useOfflineReplacementMutations(novelId: string) {
	const queryClient = useQueryClient();
	const online = useOnlineStatus();

	const invalidate = useCallback(() => {
		invalidateOfflineQueries(queryClient, "replacement", novelId);
	}, [queryClient, novelId]);

	const createMutation = useMutation({
		mutationFn: async (values: PostReplacementsBodyOne) => {
			const downloaded = await isNovelDownloaded(novelId);
			if (!downloaded) {
				const response = await postReplacements(values);
				return response.data;
			}

			const tempId = createTempId();
			const replacement: GetReplacements200DataItem = {
				id: tempId,
				from: values.from,
				to: values.to,
				novelId,
				keywordId: null,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				keyword: null,
			};

			await saveReplacement(replacement);

			if (online) {
				try {
					const response = await postReplacements(values);
					await deleteReplacementById(tempId);
					await saveReplacement(response.data);
					return response.data;
				} catch {
					await queueOfflineOperation(
						"replacement",
						"create",
						tempId,
						novelId,
						values,
					);
					return replacement;
				}
			}

			await queueOfflineOperation(
				"replacement",
				"create",
				tempId,
				novelId,
				values,
			);
			return replacement;
		},
		onSuccess: () => invalidate(),
	});

	const updateMutation = useMutation({
		mutationFn: async ({
			id,
			data,
		}: {
			id: string;
			data: PutReplacementsByIdBodyOne;
		}) => {
			const downloaded = await isNovelDownloaded(novelId);
			if (!downloaded) {
				const response = await putReplacementsById(id, data);
				return response.data;
			}

			const existing = (await getReplacementsByNovelId(novelId)).find(
				(entry) => entry.id === id,
			);
			if (!existing) {
				throw new Error("Replacement not found offline");
			}

			const updated: GetReplacements200DataItem = {
				...existing,
				...data,
				updatedAt: new Date().toISOString(),
			};
			await saveReplacement(updated);

			if (online) {
				try {
					const response = await putReplacementsById(id, data);
					await saveReplacement(response.data);
					return response.data;
				} catch {
					await queueOfflineOperation(
						"replacement",
						"update",
						id,
						novelId,
						data,
					);
					return updated;
				}
			}

			await queueOfflineOperation("replacement", "update", id, novelId, data);
			return updated;
		},
		onSuccess: () => invalidate(),
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			const downloaded = await isNovelDownloaded(novelId);
			if (!downloaded) {
				return deleteReplacementsById(id);
			}

			await deleteReplacementById(id);

			if (online) {
				try {
					return await deleteReplacementsById(id);
				} catch {
					await queueOfflineOperation("replacement", "delete", id, novelId, {});
				}
			} else {
				await queueOfflineOperation("replacement", "delete", id, novelId, {});
			}
		},
		onSuccess: () => invalidate(),
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
			const cached = await hasKeywordCategoriesCache();
			if (!cached && online) {
				const response = await postKeywordCategories(values);
				await saveKeywordCategory(
					response.data as GetKeywordCategories200DataItem,
				);
				return response.data;
			}

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
				try {
					const response = await postKeywordCategories(values);
					await deleteKeywordCategoryById(tempId);
					await saveKeywordCategory(
						response.data as GetKeywordCategories200DataItem,
					);
					return response.data;
				} catch {
					await queueOfflineOperation(
						"keywordCategory",
						"create",
						tempId,
						GLOBAL_LOOKUP_SCOPE,
						values,
					);
					return category;
				}
			}

			await queueOfflineOperation(
				"keywordCategory",
				"create",
				tempId,
				GLOBAL_LOOKUP_SCOPE,
				values,
			);
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
			const cached = await hasKeywordCategoriesCache();
			if (!cached && online) {
				const response = await putKeywordCategoriesById(id, data);
				await saveKeywordCategory(
					response.data as GetKeywordCategories200DataItem,
				);
				return response.data;
			}

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
				try {
					const response = await putKeywordCategoriesById(id, data);
					await saveKeywordCategory(
						response.data as GetKeywordCategories200DataItem,
					);
					await updateKeywordCategoryReferences(
						response.data as GetKeywordCategories200DataItem,
					);
					return response.data;
				} catch {
					await queueOfflineOperation(
						"keywordCategory",
						"update",
						id,
						GLOBAL_LOOKUP_SCOPE,
						data,
					);
					return updated;
				}
			}

			await queueOfflineOperation(
				"keywordCategory",
				"update",
				id,
				GLOBAL_LOOKUP_SCOPE,
				data,
			);
			return updated;
		},
		onSuccess: () => invalidate(),
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			const cached = await hasKeywordCategoriesCache();
			if (!cached && online) {
				return deleteKeywordCategoriesById(id);
			}

			await deleteKeywordCategoryById(id);

			if (online) {
				try {
					return await deleteKeywordCategoriesById(id);
				} catch {
					await queueOfflineOperation(
						"keywordCategory",
						"delete",
						id,
						GLOBAL_LOOKUP_SCOPE,
						{},
					);
				}
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
		invalidateOfflineQueries(
			queryClient,
			"keywordNature",
			GLOBAL_LOOKUP_SCOPE,
		);
	}, [queryClient]);

	const createMutation = useMutation({
		mutationFn: async (values: PostKeywordNaturesBodyOne) => {
			const cached = await hasKeywordNaturesCache();
			if (!cached && online) {
				const response = await postKeywordNatures(values);
				await saveKeywordNature(response.data as GetKeywordNatures200DataItem);
				return response.data;
			}

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
				try {
					const response = await postKeywordNatures(values);
					await deleteKeywordNatureById(tempId);
					await saveKeywordNature(
						response.data as GetKeywordNatures200DataItem,
					);
					return response.data;
				} catch {
					await queueOfflineOperation(
						"keywordNature",
						"create",
						tempId,
						GLOBAL_LOOKUP_SCOPE,
						values,
					);
					return nature;
				}
			}

			await queueOfflineOperation(
				"keywordNature",
				"create",
				tempId,
				GLOBAL_LOOKUP_SCOPE,
				values,
			);
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
			const cached = await hasKeywordNaturesCache();
			if (!cached && online) {
				const response = await putKeywordNaturesById(id, data);
				await saveKeywordNature(response.data as GetKeywordNatures200DataItem);
				return response.data;
			}

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
				try {
					const response = await putKeywordNaturesById(id, data);
					await saveKeywordNature(
						response.data as GetKeywordNatures200DataItem,
					);
					await updateKeywordNatureReferences(
						response.data as GetKeywordNatures200DataItem,
					);
					return response.data;
				} catch {
					await queueOfflineOperation(
						"keywordNature",
						"update",
						id,
						GLOBAL_LOOKUP_SCOPE,
						data,
					);
					return updated;
				}
			}

			await queueOfflineOperation(
				"keywordNature",
				"update",
				id,
				GLOBAL_LOOKUP_SCOPE,
				data,
			);
			return updated;
		},
		onSuccess: () => invalidate(),
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			const cached = await hasKeywordNaturesCache();
			if (!cached && online) {
				return deleteKeywordNaturesById(id);
			}

			await deleteKeywordNatureById(id);

			if (online) {
				try {
					return await deleteKeywordNaturesById(id);
				} catch {
					await queueOfflineOperation(
						"keywordNature",
						"delete",
						id,
						GLOBAL_LOOKUP_SCOPE,
						{},
					);
				}
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
