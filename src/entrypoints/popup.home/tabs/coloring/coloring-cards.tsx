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
	IconHistory,
	IconPlus,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getKeywords } from "@/api/generated/endpoints/keywords.js";
import type {
	GetKeywords200DataItem,
	GetKeywords200DataItemAliasesItem,
	GetKeywords200DataItemVersionsItem,
} from "@/api/generated/schemas";
import {
	useOfflineKeywords,
	useOnlineStatus,
	usePendingEntityIds,
} from "@/lib/offline/hooks";
import { ListItemCard } from "../list-item-card";

type KeywordGroup = {
	parent: GetKeywords200DataItem;
	aliases: GetKeywords200DataItemAliasesItem[];
	versions: GetKeywords200DataItemVersionsItem[];
};

function groupMatchesSearch(group: KeywordGroup, term: string): boolean {
	if (!term) return true;
	const t = term.toLowerCase();
	const parentMatches = group.parent.name.toLowerCase().includes(t);
	if (parentMatches) return true;
	return group.aliases.some((a) => a.name.toLowerCase().includes(t));
}

interface ColoringCardsProps extends StackProps {
	selectedNovelId: string | undefined;
	currentChapter: number | undefined;
	search: string;
	onEditKeyword: (keyword: GetKeywords200DataItem) => void;
	onEditAlias: (alias: GetKeywords200DataItemAliasesItem, parent: GetKeywords200DataItem) => void;
	onAddAlias?: (parent: GetKeywords200DataItem) => void;
	onAddVersion?: (parent: GetKeywords200DataItem) => void;
	onEditVersion?: (
		version: GetKeywords200DataItemVersionsItem,
		parent: GetKeywords200DataItem,
	) => void;
	readOnly?: boolean;
}

export function ColoringCards({
	selectedNovelId,
	currentChapter,
	search,
	onEditKeyword,
	onEditAlias,
	onAddAlias,
	onAddVersion,
	onEditVersion,
	readOnly = false,
	...props
}: ColoringCardsProps) {
	const { t } = useTranslation();
	const online = useOnlineStatus();
	const pendingEntityIds = usePendingEntityIds();
	const offline = useOfflineKeywords(selectedNovelId ?? "", "");

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
		enabled: !offline.useLocalCache && online && !!selectedNovelId,
	});

	const allItems = offline.useLocalCache
		? (offline.items ?? [])
		: (onlineQuery.data ?? []);

	const groups = useMemo(() => {
		const term = search.trim().toLowerCase();
		const all: KeywordGroup[] = allItems
			.map((parent) => ({
				parent,
				aliases: parent.aliases,
				versions: parent.versions,
			}))
			.sort((a, b) => a.parent.name.localeCompare(b.parent.name));
		if (!term) return all;
		return all.filter((g) => groupMatchesSearch(g, term));
	}, [allItems, search]);

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

	const chapter = currentChapter ?? 0;

	return (
		<Stack gap="xs" {...props}>
			{groups.map(({ parent, aliases, versions }) => {
				const isPending =
					pendingEntityIds.has(parent.id) ||
					("isDirty" in parent && parent.isDirty === true);

				const activeVersion =
					versions.find((v) => {
						const start = Number(v.startingChapter);
						const end = v.endingChapter;
						return start <= chapter && (end === null || end === undefined || Number(end) >= chapter);
					}) ??
					[...versions].sort(
						(a, b) => Number(a.startingChapter) - Number(b.startingChapter),
					)[0];

				const displayCategory = activeVersion?.category;
				const displayNature = activeVersion?.nature;
				const hasImage = Boolean(activeVersion?.imageId ?? activeVersion?.image?.url);

				return (
					<Stack key={parent.id} gap={2}>
						<ListItemCard
							onClick={readOnly ? undefined : () => onEditKeyword(parent)}
						>
							<Group wrap="nowrap" align="flex-start" gap="xs">
								<Text fw={500} style={{ flex: 1 }}>
									{parent.name}
								</Text>
								<Group gap="xs" wrap="nowrap">
									{hasImage && (
										<Badge size="xs" variant="dot" color="gray">
											{t("coloring.hasImage")}
										</Badge>
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
									{displayCategory && (
										<Text size="xs" style={{ color: displayCategory.color }}>
											{displayCategory.nameEn || displayCategory.nameAr}
										</Text>
									)}
									{displayNature && (
										<Text size="xs" style={{ color: displayNature.color }}>
											{displayNature.nameEn || displayNature.nameAr}
										</Text>
									)}
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
									{!readOnly && onAddVersion && (
										<Tooltip label={t("coloring.addVersion")} withArrow>
											<ActionIcon
												size="xs"
												variant="subtle"
												color="violet"
												onClick={(e) => {
													e.stopPropagation();
													onAddVersion(parent);
												}}
											>
												<IconHistory size={12} />
											</ActionIcon>
										</Tooltip>
									)}
								</Group>
							</Group>
							{activeVersion?.description && (
								<Text size="sm" c="dimmed">
									{activeVersion.description}
								</Text>
							)}
						</ListItemCard>

						{/* Version strip */}
						{versions.length > 1 && (
							<Group gap={4} pl="xs" wrap="wrap">
								{[...versions]
									.sort(
										(a, b) =>
											Number(a.startingChapter) - Number(b.startingChapter),
									)
									.map((version) => {
										const start = Number(version.startingChapter);
										const end = version.endingChapter;
										const isFuture = start > chapter;
										const label =
											end !== null && end !== undefined ? `ch.${start}–${Number(end)}` : `ch.${start}+`;
										const versionCategory = version.category;

										return (
											<Tooltip
												key={version.id}
												label={
													isFuture
														? t("coloring.spoilerVersion")
														: `${label}${versionCategory ? ` · ${versionCategory.nameEn || versionCategory.nameAr}` : ""}`
												}
												withArrow
											>
												<Badge
													size="xs"
													variant={isFuture ? "outline" : "light"}
													color={
														versionCategory?.color
															? undefined
															: "gray"
													}
													style={{
														cursor: readOnly ? "default" : "pointer",
														textDecoration: isFuture
															? "line-through"
															: undefined,
														opacity: isFuture ? 0.5 : 1,
														borderColor: versionCategory?.color,
														color: isFuture
															? undefined
															: versionCategory?.color,
													}}
													onClick={
														readOnly || !onEditVersion
															? undefined
															: () => onEditVersion(version, parent)
													}
												>
													{label}
												</Badge>
											</Tooltip>
										);
									})}
							</Group>
						)}

						{aliases.map((alias) => {
							const isAliasPending =
								pendingEntityIds.has(alias.id) ||
								("isDirty" in alias && alias.isDirty === true);

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
												readOnly
													? undefined
													: () => onEditAlias(alias, parent)
											}
										>
											<Group wrap="nowrap" align="flex-start" gap={4}>
												<Text fw={500} size="xs" style={{ flex: 1 }}>
													{alias.name}
												</Text>
												<Group gap={4} wrap="nowrap">
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
													{displayCategory && (
														<Text
															size="xs"
															style={{ color: displayCategory.color }}
														>
															{displayCategory.nameEn || displayCategory.nameAr}
														</Text>
													)}
													{displayNature && (
														<Text
															size="xs"
															style={{ color: displayNature.color }}
														>
															{displayNature.nameEn || displayNature.nameAr}
														</Text>
													)}
												</Group>
											</Group>
											{alias.description && (
												<Text size="xs" c="dimmed">
													{alias.description}
												</Text>
											)}
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
