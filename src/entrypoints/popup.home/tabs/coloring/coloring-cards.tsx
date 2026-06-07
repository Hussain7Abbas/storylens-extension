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
import { IconCloudUpload, IconHistory, IconPlus } from "@tabler/icons-react";
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
import type { EnrichedCategory, EnrichedNature } from "@/types/content-data";
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
	onEditAlias: (
		alias: GetKeywords200DataItemAliasesItem,
		parent: GetKeywords200DataItem,
	) => void;
	onAddAlias?: (parent: GetKeywords200DataItem) => void;
	onAddVersion?: (parent: GetKeywords200DataItem) => void;
	onEditVersion?: (
		version: GetKeywords200DataItemVersionsItem,
		parent: GetKeywords200DataItem,
	) => void;
	readOnly?: boolean;
}

function CategoryNatureRow({
	ownCategory,
	ownNature,
	inheritedCategory,
	inheritedNature,
}: {
	ownCategory: EnrichedCategory | null | undefined;
	ownNature: EnrichedNature | null | undefined;
	inheritedCategory: EnrichedCategory | null | undefined;
	inheritedNature: EnrichedNature | null | undefined;
}) {
	const displayCategory = ownCategory ?? inheritedCategory ?? null;
	const isCatInherited = !ownCategory && !!inheritedCategory;
	const displayNature = ownNature ?? inheritedNature ?? null;
	const isNatInherited = !ownNature && !!inheritedNature;

	if (!displayCategory && !displayNature) return null;

	return (
		<Group gap={4} wrap="wrap">
			{displayCategory && (
				<Text
					size="xs"
					style={{
						color: isCatInherited ? undefined : displayCategory.color,
						opacity: isCatInherited ? 0.45 : 1,
					}}
					c={isCatInherited ? "dimmed" : undefined}
				>
					{displayCategory.nameEn || displayCategory.nameAr}
				</Text>
			)}
			{displayNature && (
				<Text
					size="xs"
					style={{
						color: isNatInherited ? undefined : displayNature.color,
						opacity: isNatInherited ? 0.45 : 1,
					}}
					c={isNatInherited ? "dimmed" : undefined}
				>
					{displayNature.nameEn || displayNature.nameAr}
				</Text>
			)}
		</Group>
	);
}

function VersionCard({
	version,
	baseVersion,
	currentChapter,
	onClick,
	readOnly,
}: {
	version: GetKeywords200DataItemVersionsItem;
	baseVersion: GetKeywords200DataItemVersionsItem | undefined;
	currentChapter: number;
	onClick?: () => void;
	readOnly: boolean;
}) {
	const { t } = useTranslation();
	const start = Number(version.startingChapter);
	const end = version.endingChapter;
	const isFuture = start > currentChapter;
	const label =
		end !== null && end !== undefined
			? `ch.${start}–${Number(end)}`
			: `ch.${start}+`;

	const isBase = version.id === baseVersion?.id;
	const ownCategory = version.category as EnrichedCategory | null;
	const ownNature = version.nature as EnrichedNature | null;
	const inheritedCategory = (!isBase ? baseVersion?.category : null) as
		| EnrichedCategory
		| null
		| undefined;
	const inheritedNature = (!isBase ? baseVersion?.nature : null) as
		| EnrichedNature
		| null
		| undefined;

	const hasOwnImage = Boolean(version.imageId ?? version.image?.url);
	const ownDescription = version.description ?? null;
	const inheritedDescription =
		!ownDescription && !isBase ? (baseVersion?.description ?? null) : null;
	const displayDescription = ownDescription ?? inheritedDescription;
	const isDescInherited = !ownDescription && !!inheritedDescription;

	return (
		<ListItemCard onClick={readOnly ? undefined : onClick}>
			<Group wrap="nowrap" align="center" gap={4}>
				<Text
					size="xs"
					fw={600}
					style={{
						flex: 1,
						opacity: isFuture ? 0.5 : 1,
						textDecoration: isFuture ? "line-through" : undefined,
					}}
				>
					{label}
				</Text>
				{hasOwnImage && (
					<Badge size="xs" variant="dot" color="gray" style={{ flexShrink: 0 }}>
						{t("coloring.hasImage")}
					</Badge>
				)}
			</Group>
			<CategoryNatureRow
				ownCategory={ownCategory}
				ownNature={ownNature}
				inheritedCategory={inheritedCategory}
				inheritedNature={inheritedNature}
			/>
			{displayDescription && (
				<Text
					size="xs"
					c={isDescInherited ? "dimmed" : undefined}
					style={{ opacity: isDescInherited ? 0.45 : 1 }}
					lineClamp={2}
				>
					{displayDescription}
				</Text>
			)}
		</ListItemCard>
	);
}

function AliasCard({
	alias,
	baseVersion,
	onClick,
	readOnly,
	isPending,
}: {
	alias: GetKeywords200DataItemAliasesItem;
	baseVersion: GetKeywords200DataItemVersionsItem | undefined;
	onClick?: () => void;
	readOnly: boolean;
	isPending: boolean;
}) {
	const { t } = useTranslation();
	const hasOwnImage = Boolean(alias.imageId ?? alias.image?.url);
	const ownCategory = alias.category as EnrichedCategory | null;
	const ownNature = alias.nature as EnrichedNature | null;
	const inheritedCategory = baseVersion?.category as
		| EnrichedCategory
		| null
		| undefined;
	const inheritedNature = baseVersion?.nature as
		| EnrichedNature
		| null
		| undefined;

	const ownDescription = alias.description ?? null;
	const inheritedDescription = !ownDescription
		? (baseVersion?.description ?? null)
		: null;
	const displayDescription = ownDescription ?? inheritedDescription;
	const isDescInherited = !ownDescription && !!inheritedDescription;

	return (
		<ListItemCard onClick={readOnly ? undefined : onClick}>
			<Group wrap="nowrap" align="flex-start" gap={4}>
				<Text fw={500} size="xs" style={{ flex: 1 }}>
					{alias.name}
				</Text>
				<Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
					{hasOwnImage && (
						<Badge size="xs" variant="dot" color="gray">
							{t("coloring.hasImage")}
						</Badge>
					)}
					{isPending && (
						<Badge
							size="xs"
							color="orange"
							variant="light"
							leftSection={<IconCloudUpload size={10} />}
						>
							{t("offline.pendingSync")}
						</Badge>
					)}
					{alias.overrideStyle && (
						<Badge size="xs" variant="light" color="blue">
							{t("coloring.overrideStyle")}
						</Badge>
					)}
				</Group>
			</Group>
			<CategoryNatureRow
				ownCategory={ownCategory}
				ownNature={ownNature}
				inheritedCategory={inheritedCategory}
				inheritedNature={inheritedNature}
			/>
			{displayDescription && (
				<Text
					size="xs"
					c={isDescInherited ? "dimmed" : undefined}
					style={{ opacity: isDescInherited ? 0.45 : 1 }}
					lineClamp={2}
				>
					{displayDescription}
				</Text>
			)}
		</ListItemCard>
	);
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

				const sortedVersions = [...versions].sort(
					(a, b) => Number(a.startingChapter) - Number(b.startingChapter),
				);
				const baseVersion = sortedVersions[0];
				const baseCategory = baseVersion?.category as
					| EnrichedCategory
					| null
					| undefined;
				const baseNature = baseVersion?.nature as
					| EnrichedNature
					| null
					| undefined;
				const hasBaseImage = Boolean(
					baseVersion?.imageId ?? baseVersion?.image?.url,
				);

				return (
					<Stack key={parent.id} gap={2}>
						{/* Keyword card — shows base/original details */}
						<ListItemCard
							onClick={readOnly ? undefined : () => onEditKeyword(parent)}
						>
							<Group wrap="nowrap" align="flex-start" gap="xs">
								<Text fw={500} style={{ flex: 1 }}>
									{parent.name}
								</Text>
								<Group gap="xs" wrap="nowrap">
									{hasBaseImage && (
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
									{baseCategory && (
										<Text size="xs" style={{ color: baseCategory.color }}>
											{baseCategory.nameEn || baseCategory.nameAr}
										</Text>
									)}
									{baseNature && (
										<Text size="xs" style={{ color: baseNature.color }}>
											{baseNature.nameEn || baseNature.nameAr}
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
							{baseVersion?.description && (
								<Text size="sm" c="dimmed">
									{baseVersion.description}
								</Text>
							)}
						</ListItemCard>

						{/* 2-column grid: Versions (left) + Aliases (right) */}
						{(versions.length > 1 || aliases.length > 0) && (
							<Box pl="sm">
								<Group
									gap={8}
									align="flex-start"
									wrap="wrap"
									style={{ rowGap: 4 }}
								>
									{/* Versions column — only when multiple versions exist */}
									{versions.length > 1 && (
										<Stack gap={4} style={{ flex: 1, minWidth: 140 }}>
											<Text size="xs" c="dimmed" fw={500}>
												{t("coloring.versions")}
											</Text>
											{sortedVersions.map((version) => (
												<VersionCard
													key={version.id}
													version={version}
													baseVersion={baseVersion}
													currentChapter={chapter}
													readOnly={readOnly}
													onClick={
														onEditVersion
															? () => onEditVersion(version, parent)
															: undefined
													}
												/>
											))}
										</Stack>
									)}
									{/* Aliases column */}
									{aliases.length > 0 && (
										<Stack gap={4} style={{ flex: 1, minWidth: 140 }}>
											<Text size="xs" c="dimmed" fw={500}>
												{t("coloring.aliases")}
											</Text>
											{aliases.map((alias) => {
												const isAliasPending =
													pendingEntityIds.has(alias.id) ||
													("isDirty" in alias && alias.isDirty === true);
												return (
													<AliasCard
														key={alias.id}
														alias={alias}
														baseVersion={baseVersion}
														readOnly={readOnly}
														isPending={isAliasPending}
														onClick={() => onEditAlias(alias, parent)}
													/>
												);
											})}
										</Stack>
									)}
								</Group>
							</Box>
						)}
					</Stack>
				);
			})}
		</Stack>
	);
}
