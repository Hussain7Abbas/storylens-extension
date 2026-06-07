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
import { getReplacements } from "@/api/generated/endpoints/replacements.js";
import type {
	GetReplacements200DataItem,
	GetReplacementsParams,
} from "@/api/generated/schemas";
import {
	INFINITE_SCROLL_PAGE_SIZE,
	useInfiniteScrollList,
} from "@/hooks/use-infinite-scroll-list";
import {
	useOfflineReplacements,
	useOnlineStatus,
	usePendingEntityIds,
} from "@/lib/offline/hooks";
import { ListItemCard } from "../list-item-card";
import type { ReplacingFormModesType } from "./replacing-form";

interface ReplacingFormProps extends StackProps {
	selectedNovelId: string;
	search: string;
	setReplacement: (replacement: GetReplacements200DataItem) => void;
	setMode: (mode: ReplacingFormModesType) => void;
	readOnly?: boolean;
}

export function ReplacingCards({
	selectedNovelId,
	search,
	setReplacement,
	setMode,
	readOnly = false,
	...props
}: ReplacingFormProps) {
	const { t } = useTranslation();
	const online = useOnlineStatus();
	const pendingEntityIds = usePendingEntityIds();
	const offline = useOfflineReplacements(selectedNovelId, search);

	const onlineList = useInfiniteScrollList<
		GetReplacementsParams,
		GetReplacements200DataItem
	>({
		queryKey: [
			"replacements",
			selectedNovelId,
			{ column: "from", direction: "asc" },
		],
		fetchPage: (params, signal) => getReplacements(params, undefined, signal),
		getParams: (page, debouncedSearch) => ({
			pagination: { page, pageSize: INFINITE_SCROLL_PAGE_SIZE },
			sorting: { column: "from", direction: "asc" },
			query: {
				novelId: selectedNovelId,
				search: debouncedSearch || undefined,
			},
		}),
		search,
		enabled: !offline.useLocalCache && online,
	});

	const items = offline.useLocalCache
		? (offline.items ?? [])
		: onlineList.items;
	const isLoading = offline.useLocalCache
		? offline.isLoading
		: onlineList.isLoading;
	const isFetchingNextPage = offline.useLocalCache
		? false
		: onlineList.isFetchingNextPage;
	const loadMoreRef = offline.useLocalCache
		? undefined
		: onlineList.loadMoreRef;

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
				{t("replacing.noReplacements")}
			</Text>
		);
	}

	return (
		<Stack gap="xs" {...props}>
			{items.map((replacement) => {
				const isPending =
					pendingEntityIds.has(replacement.id) ||
					("isDirty" in replacement && replacement.isDirty === true);

				return (
					<ListItemCard
						key={replacement.id}
						onClick={
							readOnly
								? undefined
								: () => {
										setReplacement(replacement);
										setMode("edit");
									}
						}
					>
						<Group wrap="nowrap" align="flex-start" gap="xs" w="100%">
							<Text fw={500} style={{ flex: 1 }}>
								{replacement.from}
							</Text>
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
							<Text size="sm" c="dimmed" style={{ flex: 1 }}>
								{replacement.to}
							</Text>
						</Group>
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
