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
import { getReplacements } from "@/api/endpoints/replacements.js";
import type {
	GetReplacements200DataItem,
	GetReplacementsParams,
} from "@/api/schemas";
import {
	INFINITE_SCROLL_PAGE_SIZE,
	useInfiniteScrollList,
} from "@/hooks/use-infinite-scroll-list";
import {
	useOfflineReplacements,
	usePendingEntityIds,
} from "@/lib/offline/hooks";
import { ListItemCard } from "../list-item-card";
import type { ReplacingFormModesType } from "./replacing-form";

interface ReplacingFormProps extends StackProps {
	selectedNovelId: string;
	search: string;
	setReplacement: (replacement: GetReplacements200DataItem) => void;
	setMode: (mode: ReplacingFormModesType) => void;
}

export function ReplacingCards({
	selectedNovelId,
	search,
	setReplacement,
	setMode,
	...props
}: ReplacingFormProps) {
	const { t } = useTranslation();
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
		enabled: !offline.isDownloaded,
	});

	const items = offline.isDownloaded ? (offline.items ?? []) : onlineList.items;
	const isLoading = offline.isDownloaded
		? offline.isLoading
		: onlineList.isLoading;
	const isFetchingNextPage = offline.isDownloaded
		? false
		: onlineList.isFetchingNextPage;
	const loadMoreRef = offline.isDownloaded ? undefined : onlineList.loadMoreRef;

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
				const isPending = pendingEntityIds.has(replacement.id);

				return (
					<ListItemCard
						key={replacement.id}
						onClick={() => {
							setReplacement(replacement);
							setMode("edit");
						}}
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
