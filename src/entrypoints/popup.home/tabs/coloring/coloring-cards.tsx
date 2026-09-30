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
	CloudAlert as IconCloudAlert,
	CloudUpload as IconCloudUpload,
	History as IconHistory,
	Plus as IconPlus,
} from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type {
	GetKeywords200DataItem,
	GetKeywords200DataItemAliasesItem,
	GetKeywords200DataItemVersionsItem,
} from "@/api/generated/schemas";
import {
	canEditAlias,
	canEditKeyword,
	canEditVersion,
} from "@/lib/auth/permissions";
import { useCurrentUser } from "@/lib/auth/use-permissions";
import {
	useNovelKeywords,
	useNovelView,
	useOnlineStatus,
	usePendingEntityIds,
} from "@/lib/offline/hooks";
import { useLanguage } from "@/store/locale";
import type { EnrichedCategory, EnrichedNature } from "@/types/content-data";
import { fuzzyMatches } from "@/utils/fuzzy-search";
import {
	aliasDisplayName,
	aliasMatchNames,
	type Language,
	nameIn,
} from "@/utils/translation";
import { ListItemCard } from "../list-item-card";

/** Rows the reader may not change open nothing and say who can (D12 rules). */
function EditGate({
	locked,
	children,
}: {
	locked: boolean;
	children: ReactNode;
}) {
	const { t } = useTranslation();
	if (!locked) return <>{children}</>;
	return (
		<Tooltip
			label={t("permissions.creatorOrModerator")}
			withArrow
			openDelay={300}
		>
			<div>{children}</div>
		</Tooltip>
	);
}

type KeywordGroup = {
	parent: GetKeywords200DataItem;
	aliases: GetKeywords200DataItemAliasesItem[];
	versions: GetKeywords200DataItemVersionsItem[];
};

function groupMatchesSearch(
	group: KeywordGroup,
	term: string,
	language: Language,
): boolean {
	return fuzzyMatches(term, [
		nameIn(group.parent, language),
		...group.aliases.flatMap(aliasMatchNames),
		...group.versions.map((v) => v.description),
	]);
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
	locked = false,
}: {
	version: GetKeywords200DataItemVersionsItem;
	baseVersion: GetKeywords200DataItemVersionsItem | undefined;
	currentChapter: number;
	onClick?: () => void;
	readOnly: boolean;
	locked?: boolean;
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
		<EditGate locked={locked}>
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
						<Badge
							size="xs"
							variant="dot"
							color="gray"
							style={{ flexShrink: 0 }}
						>
							{version?.imageId && !version?.image
								? t("offline.waitingToUpload")
								: t("coloring.hasImage")}
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
		</EditGate>
	);
}

function AliasCard({
	alias,
	baseVersion,
	onClick,
	readOnly,
	isPending,
	locked = false,
}: {
	alias: GetKeywords200DataItemAliasesItem;
	baseVersion: GetKeywords200DataItemVersionsItem | undefined;
	onClick?: () => void;
	readOnly: boolean;
	isPending: boolean;
	locked?: boolean;
}) {
	const { t } = useTranslation();
	const language = useLanguage();
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
		<EditGate locked={locked}>
			<ListItemCard onClick={readOnly ? undefined : onClick}>
				<Group wrap="nowrap" align="flex-start" gap={4}>
					<Text fw={500} size="xs" style={{ flex: 1 }}>
						{aliasDisplayName(alias, language)}
					</Text>
					<Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
						{hasOwnImage && (
							<Badge size="xs" variant="dot" color="gray">
								{alias?.imageId && !alias?.image
									? t("offline.waitingToUpload")
									: t("coloring.hasImage")}
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
							<Badge size="xs" variant="light">
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
		</EditGate>
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
	const language = useLanguage();
	const pendingEntityIds = usePendingEntityIds();
	const { keywords: allItems, isLoading } = useNovelKeywords(selectedNovelId);
	const novelView = useNovelView(selectedNovelId).data;
	const states = novelView?.states;
	const online = useOnlineStatus();
	const notAvailableOffline = novelView?.hasSnapshot === false && !online;
	const user = useCurrentUser();

	const groups = useMemo(() => {
		const term = search.trim().toLowerCase();
		const all: KeywordGroup[] = allItems
			.map((parent) => ({
				parent,
				aliases: parent.aliases,
				versions: parent.versions,
			}))
			.sort((a, b) =>
				nameIn(a.parent, language).localeCompare(nameIn(b.parent, language)),
			);
		if (!term) return all;
		return all.filter((g) => groupMatchesSearch(g, term, language));
	}, [allItems, search, language]);

	if (isLoading) {
		return (
			<Center>
				<Loader />
			</Center>
		);
	}

	if (groups.length === 0 && notAvailableOffline) {
		return (
			<Text ta="center" c="dimmed" size="sm">
				{t("offline.notAvailableOffline")}
			</Text>
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
				const isPending = pendingEntityIds.has(parent.id);
				const needsAttention =
					states?.get(parent.id) === "conflict" ||
					states?.get(parent.id) === "rejected";
				const keywordLocked = !readOnly && !canEditKeyword(user, parent);

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
						<EditGate locked={keywordLocked}>
							<ListItemCard
								onClick={
									readOnly || keywordLocked
										? undefined
										: () => onEditKeyword(parent)
								}
							>
								<Group wrap="nowrap" align="flex-start" gap="xs">
									<Text fw={500} style={{ flex: 1 }}>
										{nameIn(parent, language)}
									</Text>
									<Group gap="xs" wrap="nowrap">
										{hasBaseImage && (
											<Badge size="xs" variant="dot" color="gray">
												{baseVersion?.imageId && !baseVersion?.image
													? t("offline.waitingToUpload")
													: t("coloring.hasImage")}
											</Badge>
										)}
										{needsAttention ? (
											<Badge
												size="xs"
												color="red"
												variant="light"
												leftSection={<IconCloudAlert size={12} />}
											>
												{t("sync.needsAttentionShort")}
											</Badge>
										) : (
											isPending && (
												<Badge
													size="xs"
													color="orange"
													variant="light"
													leftSection={<IconCloudUpload size={12} />}
												>
													{t("offline.pendingSync")}
												</Badge>
											)
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
													color="brand"
													aria-label={t("coloring.addAlias")}
													onClick={(e) => {
														e.stopPropagation();
														onAddAlias(parent);
													}}
												>
													<IconPlus size={16} aria-hidden="true" />
												</ActionIcon>
											</Tooltip>
										)}
										{!readOnly && onAddVersion && (
											<Tooltip label={t("coloring.addVersion")} withArrow>
												<ActionIcon
													size="xs"
													variant="subtle"
													color="var(--mantine-color-dimmed)"
													aria-label={t("coloring.addVersion")}
													onClick={(e) => {
														e.stopPropagation();
														onAddVersion(parent);
													}}
												>
													<IconHistory size={16} aria-hidden="true" />
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
						</EditGate>

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
													readOnly={
														readOnly || !canEditVersion(user, version, parent)
													}
													locked={
														!readOnly && !canEditVersion(user, version, parent)
													}
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
												const isAliasPending = pendingEntityIds.has(alias.id);
												const aliasLocked =
													!readOnly && !canEditAlias(user, alias, parent);
												return (
													<AliasCard
														key={alias.id}
														alias={alias}
														baseVersion={baseVersion}
														readOnly={readOnly || aliasLocked}
														locked={aliasLocked}
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
