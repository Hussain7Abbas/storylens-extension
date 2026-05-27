import {
	ActionIcon,
	Badge,
	Box,
	Center,
	Group,
	Loader,
	Stack,
	type StackProps,
	Text,
	Tooltip,
} from "@mantine/core";
import {
	IconCloudUpload,
	IconCornerDownRight,
	IconPhoto,
	IconPlus,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getKeywords } from "@/api/generated/endpoints/keywords.js";
import type { GetKeywords200DataItem } from "@/api/generated/schemas";
import {
	useOfflineKeywords,
	useOnlineStatus,
	usePendingEntityIds,
} from "@/lib/offline/hooks";
import { ListItemCard } from "../list-item-card";

type KeywordGroup = {
	parent: GetKeywords200DataItem;
	aliases: GetKeywords200DataItem[];
};

function keywordMatchesSearch(
	keyword: GetKeywords200DataItem,
	term: string,
): boolean {
	if (!term) return true;
	const t = term.toLowerCase();
	return (
		keyword.name.toLowerCase().includes(t) ||
		keyword.description.toLowerCase().includes(t) ||
		keyword.category.name.toLowerCase().includes(t) ||
		keyword.nature.name.toLowerCase().includes(t)
	);
}

function groupAndFilterKeywords(
	keywords: GetKeywords200DataItem[],
	search: string,
): KeywordGroup[] {
	const term = search.trim().toLowerCase();

	const parentsById = new Map<string, GetKeywords200DataItem>();
	const aliasesByParentId = new Map<string, GetKeywords200DataItem[]>();

	for (const k of keywords) {
		if (!k.parentId) {
			parentsById.set(k.id, k);
		} else {
			const existing = aliasesByParentId.get(k.parentId) ?? [];
			existing.push(k);
			aliasesByParentId.set(k.parentId, existing);
		}
	}

	const allGroups: KeywordGroup[] = [...parentsById.values()].map((parent) => ({
		parent,
		aliases: aliasesByParentId.get(parent.id) ?? [],
	}));

	if (!term) {
		return allGroups.sort((a, b) => a.parent.name.localeCompare(b.parent.name));
	}

	const result: KeywordGroup[] = [];

	for (const { parent, aliases } of allGroups) {
		const parentMatches = keywordMatchesSearch(parent, term);
		const matchingAliases = aliases.filter((a) =>
			keywordMatchesSearch(a, term),
		);

		if (parentMatches) {
			result.push({ parent, aliases });
		} else if (matchingAliases.length > 0) {
			result.push({ parent, aliases: matchingAliases });
		}
	}

	return result.sort((a, b) => a.parent.name.localeCompare(b.parent.name));
}

interface ColoringCardsProps extends StackProps {
	selectedNovelId: string;
	search: string;
	setKeyword: (
		keyword: GetKeywords200DataItem,
		parent?: GetKeywords200DataItem,
	) => void;
	onAddAlias?: (parent: GetKeywords200DataItem) => void;
	readOnly?: boolean;
}

export function ColoringCards({
	selectedNovelId,
	search,
	setKeyword,
	onAddAlias,
	readOnly = false,
	...props
}: ColoringCardsProps) {
	const { t } = useTranslation();
	const online = useOnlineStatus();
	const pendingEntityIds = usePendingEntityIds();
	const offline = useOfflineKeywords(selectedNovelId, "");

	const onlineQuery = useQuery({
		queryKey: ["keywords", selectedNovelId, "all"],
		queryFn: async () => {
			const response = await getKeywords(
				{
					pagination: { page: 1, pageSize: 500 },
					sorting: { column: "name", direction: "asc" },
					query: { novelId: selectedNovelId },
				} as Parameters<typeof getKeywords>[0],
				undefined,
			);
			return (response.data.data as GetKeywords200DataItem[]) ?? [];
		},
		enabled: !offline.useLocalCache && online,
	});

	const allItems = offline.useLocalCache
		? (offline.items ?? [])
		: (onlineQuery.data ?? []);

	const groups = useMemo(
		() => groupAndFilterKeywords(allItems, search),
		[allItems, search],
	);

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

	if (groups.length === 0) {
		return (
			<Text ta="center" c="dimmed">
				{t("home.noKeywords")}
			</Text>
		);
	}

	return (
		<Stack gap="xs" {...props}>
			{groups.map(({ parent, aliases }) => {
				const isPending =
					pendingEntityIds.has(parent.id) ||
					("isDirty" in parent && parent.isDirty === true);
				const hasImage = Boolean(parent.imageId ?? parent.image?.url);

				return (
					<Stack key={parent.id} gap={2}>
						<ListItemCard
							onClick={readOnly ? undefined : () => setKeyword(parent)}
						>
							<Group wrap="nowrap" align="flex-start" gap="xs">
								<Text fw={500} style={{ flex: 1 }}>
									{parent.name}
								</Text>
								<Group gap="xs" wrap="nowrap">
									{hasImage && (
										<IconPhoto
											size={14}
											stroke={1.75}
											style={{ flexShrink: 0, opacity: 0.7 }}
											aria-label={t("coloring.hasImage")}
										/>
									)}
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
									<Text size="xs" style={{ color: parent.category.color }}>
										{parent.category.name}
									</Text>
									<Text size="xs" style={{ color: parent.nature.color }}>
										{parent.nature.name}
									</Text>
									{!readOnly && onAddAlias && (
										<Tooltip label={t("coloring.addAlias")} withArrow>
											<ActionIcon
												size="xs"
												variant="subtle"
												color="green"
												onClick={(e) => {
													e.stopPropagation();
													onAddAlias(parent);
												}}
											>
												<IconPlus size={12} />
											</ActionIcon>
										</Tooltip>
									)}
								</Group>
							</Group>
							<Text size="sm" c="dimmed">
								{parent.description}
							</Text>
						</ListItemCard>

						{aliases.map((alias) => {
							const isAliasPending =
								pendingEntityIds.has(alias.id) ||
								("isDirty" in alias && alias.isDirty === true);
							const aliasHasImage = Boolean(alias.imageId ?? alias.image?.url);

							return (
								<Group
									key={alias.id}
									gap="xs"
									wrap="nowrap"
									pl="md"
									align="stretch"
								>
									<Box
										style={{
											display: "flex",
											alignItems: "center",
											color: "var(--mantine-color-dimmed)",
											flexShrink: 0,
										}}
									>
										<IconCornerDownRight size={14} stroke={1.5} />
									</Box>
									<Box style={{ flex: 1, minWidth: 0 }}>
										<ListItemCard
											onClick={
												readOnly ? undefined : () => setKeyword(alias, parent)
											}
										>
											<Group wrap="nowrap" align="flex-start" gap={4}>
												<Text fw={500} size="xs" style={{ flex: 1 }}>
													{alias.name}
												</Text>
												<Group gap={4} wrap="nowrap">
													{aliasHasImage && (
														<IconPhoto
															size={12}
															stroke={1.75}
															style={{ flexShrink: 0, opacity: 0.7 }}
															aria-label={t("coloring.hasImage")}
														/>
													)}
													{isAliasPending && (
														<Badge
															size="xs"
															color="orange"
															variant="light"
															leftSection={<IconCloudUpload size={12} />}
														>
															{t("offline.pendingSync")}
														</Badge>
													)}
													<Text
														size="xs"
														style={{ color: alias.category.color }}
													>
														{alias.category.name}
													</Text>
													<Text size="xs" style={{ color: alias.nature.color }}>
														{alias.nature.name}
													</Text>
												</Group>
											</Group>
											<Text size="xs" c="dimmed">
												{alias.description}
											</Text>
										</ListItemCard>
									</Box>
								</Group>
							);
						})}
					</Stack>
				);
			})}
		</Stack>
	);
}
