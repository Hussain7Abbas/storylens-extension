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
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getReplacements } from "@/api/generated/endpoints/replacements.js";
import type { GetReplacements200DataItem } from "@/api/generated/schemas";
import {
	useOfflineReplacements,
	useOnlineStatus,
	usePendingEntityIds,
} from "@/lib/offline/hooks";
import { fuzzyMatches } from "@/utils/fuzzy-search";
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
	const offline = useOfflineReplacements(selectedNovelId, "");

	const onlineQuery = useQuery({
		queryKey: ["replacements", selectedNovelId, "all"],
		queryFn: async ({ signal }) => {
			const items: GetReplacements200DataItem[] = [];
			for (let page = 1; ; page++) {
				const response = await getReplacements(
					{
						pagination: { page, pageSize: 500 },
						sorting: { column: "from", direction: "asc" },
						query: { novelId: selectedNovelId },
					},
					undefined,
					signal,
				);
				items.push(...response.data.data);
				if (!response.data.data.length || items.length >= response.data.total)
					return items;
			}
		},
		enabled: !offline.useLocalCache && online,
	});
	const items = (
		offline.useLocalCache ? (offline.items ?? []) : (onlineQuery.data ?? [])
	).filter((item) => fuzzyMatches(search, [item.from, item.to]));
	const isLoading = offline.useLocalCache
		? offline.isLoading
		: onlineQuery.isLoading;

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
		</Stack>
	);
}
