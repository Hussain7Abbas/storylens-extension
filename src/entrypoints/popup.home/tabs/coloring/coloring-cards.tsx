import {
	Badge,
	Center,
	Group,
	Loader,
	Stack,
	type StackProps,
	Text,
} from "@mantine/core";
import { IconCloudUpload } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { getKeywords } from "@/api/endpoints/keywords.js";
import type { GetKeywords200DataItem, GetKeywordsParams } from "@/api/schemas";
import {
	INFINITE_SCROLL_PAGE_SIZE,
	useInfiniteScrollList,
} from "@/hooks/use-infinite-scroll-list";
import { useOfflineKeywords, useOnlineStatus, usePendingEntityIds } from "@/lib/offline/hooks";
import { ListItemCard } from "../list-item-card";
import type { ColoringFormModesType } from "./coloring-form";

interface ColoringFormProps extends StackProps {
	selectedNovelId: string;
	search: string;
	setKeyword: (keyword: GetKeywords200DataItem) => void;
	setMode: (mode: ColoringFormModesType) => void;
	readOnly?: boolean;
}

export function ColoringCards({
	selectedNovelId,
	search,
	setKeyword,
	setMode,
	readOnly = false,
	...props
}: ColoringFormProps) {
	const { t } = useTranslation();
	const online = useOnlineStatus();
	const pendingEntityIds = usePendingEntityIds();
	const offline = useOfflineKeywords(selectedNovelId, search);

	const onlineList = useInfiniteScrollList<
		GetKeywordsParams,
		GetKeywords200DataItem
	>({
		queryKey: [
			"keywords",
			selectedNovelId,
			{ column: "name", direction: "asc" },
		],
		fetchPage: (params, signal) => getKeywords(params, undefined, signal),
		getParams: (page, debouncedSearch) => ({
			pagination: { page, pageSize: INFINITE_SCROLL_PAGE_SIZE },
			sorting: { column: "name", direction: "asc" },
			query: {
				novelId: selectedNovelId,
				search: debouncedSearch || undefined,
			},
		}),
		search,
		enabled: !offline.useLocalCache && online,
	});

	const items = offline.useLocalCache ? (offline.items ?? []) : onlineList.items;
	const isLoading = offline.useLocalCache
		? offline.isLoading
		: onlineList.isLoading;
	const isFetchingNextPage = offline.useLocalCache
		? false
		: onlineList.isFetchingNextPage;
	const loadMoreRef = offline.useLocalCache ? undefined : onlineList.loadMoreRef;

	if (isLoading) {
		return (
			<Center>
				<Loader />
			</Center>
		);
	}

	if (items.length === 0) {
		return (
			<Text ta="center" c="dimmed">
				{t("home.noKeywords")}
			</Text>
		);
	}

	return (
		<Stack gap="xs" {...props}>
			{items.map((keyword) => {
				const isPending =
					pendingEntityIds.has(keyword.id) ||
					("isDirty" in keyword && keyword.isDirty === true);

				return (
					<ListItemCard
						key={keyword.id}
						onClick={
							readOnly
								? undefined
								: () => {
										setKeyword(keyword);
										setMode("edit");
									}
						}
					>
						<Group wrap="nowrap" align="flex-start" gap="xs">
							<Text fw={500} style={{ flex: 1 }}>
								{keyword.name}
							</Text>
							<Group gap="xs" wrap="nowrap">
								{isPending && (
									<Badge
										size="xs"
										color="orange"
										variant="light"
										leftSection={<IconCloudUpload size={12} />}
									>
										{t("offline.pendingSync")}
									</Badge>
								)}
								<Text size="xs" style={{ color: keyword.category.color }}>
									{keyword.category.name}
								</Text>
								<Text size="xs" style={{ color: keyword.nature.color }}>
									{keyword.nature.name}
								</Text>
							</Group>
						</Group>
						<Text size="sm" c="dimmed">
							{keyword.description}
						</Text>
					</ListItemCard>
				);
			})}
			{loadMoreRef && <div ref={loadMoreRef} />}
			{isFetchingNextPage && (
				<Center>
					<Loader size="sm" />
				</Center>
			)}
		</Stack>
	);
}
