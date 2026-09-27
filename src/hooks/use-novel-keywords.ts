import { useQuery } from "@tanstack/react-query";
import { getKeywords } from "@/api/generated/endpoints/keywords.js";
import type { GetKeywords200DataItem } from "@/api/generated/schemas";
import { useOfflineKeywords, useOnlineStatus } from "@/lib/offline/hooks";

/**
 * Every keyword of a novel: from the offline store when the novel is
 * downloaded or the browser is offline, otherwise all catalogue pages online.
 */
export function useNovelKeywords(novelId: string | undefined): {
	keywords: GetKeywords200DataItem[];
	isLoading: boolean;
} {
	const online = useOnlineStatus();
	const offline = useOfflineKeywords(novelId ?? "", "");

	const onlineQuery = useQuery({
		queryKey: ["keywords", novelId, "all"],
		queryFn: async ({ signal }) => {
			const items: GetKeywords200DataItem[] = [];
			for (let page = 1; ; page++) {
				const response = await getKeywords(
					{
						pagination: { page, pageSize: 500 },
						sorting: { column: "name", direction: "asc" },
						query: { novelId },
					},
					undefined,
					signal,
				);
				items.push(...response.data.data);
				if (!response.data.data.length || items.length >= response.data.total)
					return items;
			}
		},
		enabled: !offline.useLocalCache && online && !!novelId,
	});

	return offline.useLocalCache
		? { keywords: offline.items ?? [], isLoading: offline.isLoading }
		: { keywords: onlineQuery.data ?? [], isLoading: onlineQuery.isLoading };
}
