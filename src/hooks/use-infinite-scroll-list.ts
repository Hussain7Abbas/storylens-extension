import { useDebouncedValue, useIntersection } from "@mantine/hooks";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { AxiosResponse } from "axios";
import { useEffect, useMemo } from "react";

export const INFINITE_SCROLL_PAGE_SIZE = 25;

interface PaginatedResponse<TItem> {
	data: TItem[];
	total: number;
}

interface UseInfiniteScrollListOptions<TParams, TItem> {
	queryKey: readonly unknown[];
	fetchPage: (
		params: TParams,
		signal?: AbortSignal,
	) => Promise<AxiosResponse<PaginatedResponse<TItem>>>;
	getParams: (page: number, search: string) => TParams;
	search: string;
	debounceMs?: number;
	enabled?: boolean;
}

export function useInfiniteScrollList<TParams, TItem>({
	queryKey,
	fetchPage,
	getParams,
	search,
	debounceMs = 300,
	enabled = true,
}: UseInfiniteScrollListOptions<TParams, TItem>) {
	const [debouncedSearch] = useDebouncedValue(search.trim(), debounceMs);

	const query = useInfiniteQuery({
		queryKey: [...queryKey, debouncedSearch],
		queryFn: ({ pageParam, signal }) =>
			fetchPage(getParams(pageParam, debouncedSearch), signal),
		initialPageParam: 1,
		getNextPageParam: (lastPage, allPages) => {
			const total = lastPage.data.total;
			const loaded = allPages.reduce(
				(sum, page) => sum + page.data.data.length,
				0,
			);

			return loaded < total ? allPages.length + 1 : undefined;
		},
		enabled,
	});

	const items = useMemo(
		() => query.data?.pages.flatMap((page) => page.data.data) ?? [],
		[query.data],
	);

	const { ref, entry } = useIntersection({
		root: null,
		threshold: 0,
	});

	useEffect(() => {
		if (
			entry?.isIntersecting &&
			query.hasNextPage &&
			!query.isFetchingNextPage
		) {
			void query.fetchNextPage();
		}
	}, [
		entry?.isIntersecting,
		query.fetchNextPage,
		query.hasNextPage,
		query.isFetchingNextPage,
	]);

	return {
		items,
		isLoading: query.isLoading,
		isFetchingNextPage: query.isFetchingNextPage,
		loadMoreRef: ref,
	};
}
