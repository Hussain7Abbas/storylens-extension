import {
	ActionIcon,
	Badge,
	Box,
	Center,
	Group,
	Image,
	Loader,
	Stack,
	type StackProps,
	Text,
	Tooltip,
} from "@mantine/core";
import { History as IconHistory, Plus as IconPlus } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type {
	GetKeywords200DataItem,
	GetKeywords200DataItemAliasesItem,
	GetKeywords200DataItemVersionsItem,
} from "@/api/generated/schemas";
import { SyncBadge } from "@/components/sync-badge";
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
import type { EntitySyncState } from "@/lib/offline/types";
import { useLanguage } from "@/store/locale";
import type { EnrichedCategory, EnrichedNature } from "@/types/content-data";
import { fuzzyMatches } from "@/utils/fuzzy-search";
import {
	type RawImage,
	resolveKeywordImage,
} from "@/utils/resolve-keyword-version";
import {
	aliasDisplayName,
	aliasMatchNames,
	displayNameIn,
	keywordDescriptionIn,
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
		...group.versions.flatMap((v) => [
			v.descriptionAr,
			v.descriptionEn,
			v.description,
		]),
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

/**
 * A row's image: its own, else the one it inherits through the keyword's
 * fallback chain (the active version, the latest version that has one, then the
 * base version), dimmed like the other inherited values. Keeps every row
 * showing the character instead of leaving gaps.
 */
function RowThumb({
	own,
	fallback,
	alt,
	size,
}: {
	own: RawImage;
	fallback: RawImage;
	alt: string;
	size: number;
}) {
	const inherited = !own?.url;
	const url = own?.url ?? fallback?.url ?? null;
	if (!url) return null;
	return (
		<Image
			src={url}
			alt={alt}
			w={size}
			h={size}
			radius="sm"
			fit="cover"
			style={{ flexShrink: 0, opacity: inherited ? 0.45 : 1 }}
		/>
	);
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
	const language = useLanguage();
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
					{displayNameIn(displayCategory, language)}
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
					{displayNameIn(displayNature, language)}
				</Text>
			)}
		</Group>
	);
}

function VersionCard({
	version,
	baseVersion,
	fallbackImage,
	currentChapter,
	onClick,
	readOnly,
	locked = false,
	syncState,
}: {
	syncState?: EntitySyncState;
	version: GetKeywords200DataItemVersionsItem;
	baseVersion: GetKeywords200DataItemVersionsItem | undefined;
	/** The keyword's resolved image, shown when this version has none. */
	fallbackImage: RawImage;
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
	const language = useLanguage();
	const ownDescription = keywordDescriptionIn(version, language);
	const inheritedDescription =
		!ownDescription && !isBase
			? keywordDescriptionIn(baseVersion, language)
			: null;
	const displayDescription = ownDescription ?? inheritedDescription;
	const isDescInherited = !ownDescription && !!inheritedDescription;

	return (
		<EditGate locked={locked}>
			<ListItemCard onClick={readOnly ? undefined : onClick}>
				<Group wrap="nowrap" align="center" gap={6}>
					<RowThumb
						own={version.image as RawImage}
						fallback={fallbackImage}
						alt={label}
						size={28}
					/>
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
					<SyncBadge state={syncState} />
					{hasOwnImage && !version.image && (
						<Badge
							size="xs"
							variant="dot"
							color="gray"
							style={{ flexShrink: 0 }}
						>
							{t("offline.waitingToUpload")}
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
	fallbackImage,
	onClick,
	readOnly,
	syncState,
	locked = false,
}: {
	alias: GetKeywords200DataItemAliasesItem;
	baseVersion: GetKeywords200DataItemVersionsItem | undefined;
	/** The keyword's resolved image, shown when this alias has none. */
	fallbackImage: RawImage;
	onClick?: () => void;
	readOnly: boolean;
	syncState: EntitySyncState | undefined;
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

	const ownDescription = keywordDescriptionIn(alias, language);
	const inheritedDescription = !ownDescription
		? keywordDescriptionIn(baseVersion, language)
		: null;
	const displayDescription = ownDescription ?? inheritedDescription;
	const isDescInherited = !ownDescription && !!inheritedDescription;

	return (
		<EditGate locked={locked}>
			<ListItemCard onClick={readOnly ? undefined : onClick}>
				<Group wrap="nowrap" align="flex-start" gap={6}>
					<RowThumb
						own={alias.image as RawImage}
						fallback={fallbackImage}
						alt={aliasDisplayName(alias, language)}
						size={28}
					/>
					<Text fw={500} size="xs" style={{ flex: 1 }}>
						{aliasDisplayName(alias, language)}
					</Text>
					<Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
						{hasOwnImage && !alias.image && (
							<Badge size="xs" variant="dot" color="gray">
								{t("offline.waitingToUpload")}
							</Badge>
						)}
						<SyncBadge state={syncState} />
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
				// What rows without an image of their own show.
				const keywordImage = resolveKeywordImage(parent, chapter);

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
									<RowThumb
										own={baseVersion?.image as RawImage}
										fallback={keywordImage}
										alt={nameIn(parent, language)}
										size={36}
									/>
									<Text fw={500} style={{ flex: 1 }}>
										{nameIn(parent, language)}
									</Text>
									<Group gap="xs" wrap="nowrap">
										{hasBaseImage && !baseVersion?.image && (
											<Badge size="xs" variant="dot" color="gray">
												{t("offline.waitingToUpload")}
											</Badge>
										)}
										<SyncBadge
											state={
												states?.get(parent.id) ??
												(isPending ? "pending" : undefined)
											}
										/>
										{baseCategory && (
											<Text size="xs" style={{ color: baseCategory.color }}>
												{displayNameIn(baseCategory, language)}
											</Text>
										)}
										{baseNature && (
											<Text size="xs" style={{ color: baseNature.color }}>
												{displayNameIn(baseNature, language)}
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
								{keywordDescriptionIn(baseVersion, language) && (
									<Text size="sm" c="dimmed">
										{keywordDescriptionIn(baseVersion, language)}
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
													fallbackImage={keywordImage}
													currentChapter={chapter}
													readOnly={
														readOnly || !canEditVersion(user, version, parent)
													}
													locked={
														!readOnly && !canEditVersion(user, version, parent)
													}
													syncState={states?.get(version.id)}
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
														fallbackImage={keywordImage}
														readOnly={readOnly || aliasLocked}
														locked={aliasLocked}
														syncState={
															states?.get(alias.id) ??
															(isAliasPending ? "pending" : undefined)
														}
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
