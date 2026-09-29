import {
	Alert,
	Badge,
	Button,
	Group,
	Loader,
	Select,
	Stack,
	Table,
	Text,
	Textarea,
	TextInput,
	Tooltip,
} from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { browser } from "#imports";
import type { GetKeywords200DataItem } from "@/api/generated/schemas";
import { sendMessage } from "@/entrypoints/background/messaging";
import { useNovelKeywords } from "@/hooks/use-novel-keywords";
import { useRefreshContentScript } from "@/hooks/useRefreshContentScript";
import { trackEvent } from "@/lib/analytics/client";
import { useCanMutateKeywords } from "@/lib/auth";
import { toAiLanguage } from "@/lib/desktop-client/ai-language";
import {
	buildChapterExtractionPrompt,
	type ExtractedKeyword,
	parseChapterExtraction,
} from "@/lib/desktop-client/chapter-extraction";
import {
	EXTRACTION_PANEL_MESSAGE,
	type ExtractionPanelMessage,
} from "@/lib/desktop-client/chapter-panel";
import { relatedSuggestionDescription } from "@/lib/desktop-client/keyword-suggestion";
import { executeLocalizedPrompt } from "@/lib/desktop-client/localized-prompt";
import { ensureNovelContext } from "@/lib/desktop-client/novel-context";
import { aiPrompts, desktopSettings } from "@/lib/desktop-client/settings";
import { useAiConfigured } from "@/lib/desktop-client/use-ai-configured";
import {
	useCachedNovelsList,
	useOfflineKeywordAliasMutations,
	useOfflineKeywordCategories,
	useOfflineKeywordMutations,
	useOfflineKeywordNatures,
	useOfflineKeywordVersionMutations,
} from "@/lib/offline/hooks";
import { useLanguage } from "@/store/locale";
import type { Novel } from "@/types/models";
import { fuzzyMatches } from "@/utils/fuzzy-search";
import { type Language, nameFields, nameIn } from "@/utils/translation";
import { useDetectedNovel } from "../popup.home/use-detected-novel";

type RowAction = "new" | "alias" | "version";

type Row = ExtractedKeyword & {
	key: string;
	parentId: string | null;
	/** The reader picked or cleared the parent; stop applying the AI suggestion. */
	parentTouched?: boolean;
	saving?: RowAction;
	saved?: RowAction;
	error?: string;
};

type ExtractionState =
	| { status: "waiting" }
	| { status: "loading" }
	| { status: "ready" }
	| { status: "error"; message: string };

function postToPanel(message: ExtractionPanelMessage): void {
	// The panel checks that the message comes from this frame; it carries no page data.
	window.parent.postMessage(message, "*");
}

function lookupLabel(item: {
	nameEn?: string | null;
	nameAr?: string | null;
}): string {
	return item.nameEn || item.nameAr || "";
}

/** Keyword whose name or alias matches the AI's suggested parent name. */
function findParentId(
	keywords: GetKeywords200DataItem[],
	name: string,
	language: Language,
): string | null {
	const key = name.trim().toLowerCase();
	return (
		keywords.find(
			(keyword) =>
				nameIn(keyword, language).trim().toLowerCase() === key ||
				keyword.aliases.some(
					(alias) => alias.name.trim().toLowerCase() === key,
				),
		)?.id ?? null
	);
}

function ParentSelect({
	keywords,
	loading,
	value,
	onChange,
	disabled,
}: {
	keywords: GetKeywords200DataItem[];
	loading: boolean;
	value: string | null;
	onChange: (value: string | null) => void;
	disabled: boolean;
}) {
	const { t } = useTranslation();
	const language = useLanguage();
	const searchable = useMemo(
		() =>
			new Map(
				keywords.map((keyword) => [
					keyword.id,
					[
						nameIn(keyword, language),
						...keyword.aliases.map((alias) => alias.name),
					],
				]),
			),
		[keywords, language],
	);
	return (
		<Select
			size="xs"
			searchable
			clearable
			disabled={disabled}
			placeholder={t("extract.selectParent")}
			nothingFoundMessage={t("extract.noParentFound")}
			rightSection={loading ? <Loader size="xs" /> : undefined}
			data={keywords.map((keyword) => ({
				value: keyword.id,
				label: nameIn(keyword, language),
			}))}
			limit={50}
			filter={({ options, search }) =>
				options.filter(
					(option) =>
						"value" in option &&
						fuzzyMatches(
							search,
							searchable.get(option.value) ?? [option.label],
						),
				)
			}
			value={value}
			onChange={onChange}
			comboboxProps={{ withinPortal: true }}
		/>
	);
}

export function ExtractionView() {
	const { t, i18n } = useTranslation();
	const language = toAiLanguage(i18n.language);
	const canMutate = useCanMutateKeywords();
	const refreshContent = useRefreshContentScript();
	const { novels, isLoading: novelsLoading } = useCachedNovelsList();
	const { selectedNovel, setSelectedNovel, currentTabNovel } = useDetectedNovel(
		novels,
		novels,
	);
	const novelId = selectedNovel?.id;
	const chapter = currentTabNovel?.chapter;
	const { data: categories } = useOfflineKeywordCategories();
	const { data: natures } = useOfflineKeywordNatures();
	const { keywords, isLoading: keywordsLoading } = useNovelKeywords(novelId);
	const keywordMutations = useOfflineKeywordMutations(novelId ?? "");
	const aliasMutations = useOfflineKeywordAliasMutations(novelId ?? "");
	const versionMutations = useOfflineKeywordVersionMutations(novelId ?? "");
	const [state, setState] = useState<ExtractionState>({ status: "waiting" });
	const [rows, setRows] = useState<Row[]>([]);
	const [attempt, setAttempt] = useState(0);
	const inputs = useRef({ categories, natures, keywords, novelId });
	inputs.current = { categories, natures, keywords, novelId };
	const aiConfigured = useAiConfigured();
	const ready =
		aiConfigured &&
		!!novelId &&
		!keywordsLoading &&
		!!categories?.length &&
		!!natures?.length;

	useEffect(() => {
		const report = () =>
			postToPanel({
				type: EXTRACTION_PANEL_MESSAGE,
				action: "resize",
				height: Math.ceil(document.documentElement.scrollHeight),
			});
		const observer = new ResizeObserver(report);
		observer.observe(document.body);
		report();
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		// `attempt` re-runs the extraction when the reader clicks Retry.
		if (!ready || attempt < 0) return;
		const controller = new AbortController();
		setState({ status: "loading" });
		setRows([]);
		void (async () => {
			const settings = await desktopSettings();
			if (!settings.token || !settings.model || !settings.effort)
				throw new Error(t("desktop.selectModel"));
			const [tab] = await browser.tabs.query({
				active: true,
				currentWindow: true,
			});
			if (tab?.id === undefined) throw new Error(t("extract.noPage"));
			const { text } = await sendMessage("getChapterText", undefined, {
				tabId: tab.id,
			});
			if (!text.trim()) throw new Error(t("extract.noText"));
			const lookup = {
				categories: inputs.current.categories ?? [],
				natures: inputs.current.natures ?? [],
			};
			const knownNames = inputs.current.keywords.flatMap((keyword) => [
				nameIn(keyword, language),
				...keyword.aliases.map((alias) => alias.name),
			]);
			const currentNovelId = inputs.current.novelId;
			const [prompts, novelContext] = await Promise.all([
				aiPrompts(),
				currentNovelId
					? ensureNovelContext({
							novelId: currentNovelId,
							language,
							settings,
							signal: controller.signal,
						})
					: "",
			]);
			if (controller.signal.aborted) return;
			trackEvent("ai_chapter_extraction_requested", {
				effort: settings.effort,
			});
			const items = await executeLocalizedPrompt({
				prompt: buildChapterExtractionPrompt({
					text,
					...lookup,
					knownNames,
					language,
					instructions: prompts.keywordPrompt,
					novelContext,
				}),
				language,
				settings,
				signal: controller.signal,
				parse: (output) =>
					parseChapterExtraction(
						output,
						lookup.categories,
						lookup.natures,
						knownNames,
					),
				texts: (result) => result.map((item) => item.description),
			});
			if (controller.signal.aborted) return;
			setRows(
				items.map((item, index) => ({
					...item,
					key: `${index}-${item.name}`,
					parentId: item.suggestedParent
						? findParentId(
								inputs.current.keywords,
								item.suggestedParent.name,
								language,
							)
						: null,
				})),
			);
			setState({ status: "ready" });
		})().catch((error: unknown) => {
			if (controller.signal.aborted) return;
			setState({
				status: "error",
				message: error instanceof Error ? error.message : t("extract.failed"),
			});
		});
		return () => controller.abort();
	}, [ready, attempt, language, t]);

	// A suggested parent from this same list links up once the reader saves it.
	useEffect(() => {
		setRows((current) =>
			current.some(
				(row) => row.suggestedParent && !row.parentId && !row.parentTouched,
			)
				? current.map((row) =>
						row.suggestedParent && !row.parentId && !row.parentTouched
							? {
									...row,
									parentId: findParentId(
										keywords,
										row.suggestedParent.name,
										language,
									),
								}
							: row,
					)
				: current,
		);
	}, [keywords, language]);

	const updateRow = (key: string, patch: Partial<Row>) =>
		setRows((current) =>
			current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
		);

	const save = async (row: Row, action: RowAction) => {
		if (!novelId) return;
		const parent = keywords.find((keyword) => keyword.id === row.parentId);
		if (action === "new" && (!row.categoryId || !row.natureId)) {
			updateRow(row.key, { error: t("extract.categoryNatureRequired") });
			return;
		}
		if (action !== "new" && !parent) {
			updateRow(row.key, { error: t("extract.parentRequired") });
			return;
		}
		updateRow(row.key, { saving: action, error: undefined });
		try {
			const description =
				action === "new" || !parent
					? row.description
					: relatedSuggestionDescription(
							row,
							{
								kind: action,
								name: row.name,
								parent: nameIn(parent, language),
							},
							language,
						);
			if (action === "new")
				await keywordMutations.createMutation.mutateAsync({
					novelId,
					...nameFields(language, row.name),
					matchingType: "FULL",
					categoryId: row.categoryId as string,
					natureId: row.natureId as string,
					description: description || undefined,
				});
			else if (action === "alias" && parent)
				await aliasMutations.createMutation.mutateAsync({
					keywordId: parent.id,
					name: row.name,
					description: description || undefined,
					matchingType: "FULL",
					categoryId: row.categoryId ?? null,
					natureId: row.natureId ?? null,
					overrideStyle: false,
				});
			else if (parent)
				await versionMutations.createMutation.mutateAsync({
					keywordId: parent.id,
					categoryId: row.categoryId,
					natureId: row.natureId,
					description: description || undefined,
					currentChapter: chapter,
				});
			updateRow(row.key, { saving: undefined, saved: action });
			trackEvent("ai_extracted_keyword_saved", { action });
			await refreshContent();
		} catch (error) {
			updateRow(row.key, {
				saving: undefined,
				error: error instanceof Error ? error.message : t("extract.saveFailed"),
			});
		}
	};

	const categoryOptions = (categories ?? []).map((item) => ({
		value: item.id,
		label: lookupLabel(item),
	}));
	const natureOptions = (natures ?? []).map((item) => ({
		value: item.id,
		label: lookupLabel(item),
	}));

	return (
		<Stack gap="xs" p="xs">
			{!novelId && (
				<Select
					size="xs"
					label={t("coloring.novel")}
					placeholder={t("home.selectNovelPlaceholder")}
					searchable
					disabled={novelsLoading}
					data={novels.map((novel: Novel) => ({
						value: novel.id,
						label: nameIn(novel, language),
					}))}
					value={null}
					onChange={(value) =>
						setSelectedNovel(novels.find((novel) => novel.id === value))
					}
					comboboxProps={{ withinPortal: true }}
				/>
			)}
			{!canMutate && (
				<Text size="xs" c="dimmed">
					{t("auth.guestReadOnly")}
				</Text>
			)}
			{!aiConfigured && (
				<Alert color="orange" variant="light" py="xs">
					<Text size="sm">{t("desktop.configureAi")}</Text>
				</Alert>
			)}
			{(state.status === "waiting" || state.status === "loading") &&
				aiConfigured &&
				novelId && (
					<Group gap="xs" role="status">
						<Loader size="xs" />
						<Text size="sm">{t("extract.loading")}</Text>
					</Group>
				)}
			{state.status === "error" && (
				<Alert color="red" py="xs">
					<Group justify="space-between" gap="xs">
						<Text size="sm">
							{t("extract.failed")}: {state.message}
						</Text>
						<Tooltip
							label={t("desktop.configureAi")}
							disabled={aiConfigured}
							withArrow
						>
							<Button
								size="compact-xs"
								variant="light"
								data-disabled={!aiConfigured || undefined}
								onClick={(event) => {
									if (!aiConfigured) event.preventDefault();
									else setAttempt((value) => value + 1);
								}}
							>
								{t("extract.retry")}
							</Button>
						</Tooltip>
					</Group>
				</Alert>
			)}
			{state.status === "ready" && rows.length === 0 && (
				<Text size="sm" c="dimmed">
					{t("extract.empty")}
				</Text>
			)}
			{rows.length > 0 && (
				<Table.ScrollContainer minWidth={1000}>
					<Table verticalSpacing={6} horizontalSpacing="xs" striped>
						<Table.Thead>
							<Table.Tr>
								<Table.Th w="15%">{t("coloring.name")}</Table.Th>
								<Table.Th>{t("coloring.description")}</Table.Th>
								<Table.Th w="13%">{t("coloring.category")}</Table.Th>
								<Table.Th w="12%">{t("coloring.nature")}</Table.Th>
								<Table.Th w="16%">{t("extract.parent")}</Table.Th>
								<Table.Th w={250}>{t("extract.actions")}</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{rows.map((row) => {
								const locked = !canMutate || !!row.saving || !!row.saved;
								// The AI's relation leads while its parent is still selected.
								const suggested =
									row.suggestedParent &&
									row.parentId &&
									row.parentId ===
										findParentId(keywords, row.suggestedParent.name, language)
										? row.suggestedParent.relation
										: undefined;
								return (
									<Table.Tr key={row.key}>
										<Table.Td>
											<TextInput
												size="xs"
												aria-label={t("coloring.name")}
												value={row.name}
												disabled={locked}
												onChange={(event) =>
													updateRow(row.key, {
														name: event.currentTarget.value,
													})
												}
											/>
										</Table.Td>
										<Table.Td>
											<Textarea
												size="xs"
												autosize
												minRows={1}
												maxRows={4}
												aria-label={t("coloring.description")}
												value={row.description}
												disabled={locked}
												onChange={(event) =>
													updateRow(row.key, {
														description: event.currentTarget.value,
													})
												}
											/>
										</Table.Td>
										<Table.Td>
											<Select
												size="xs"
												aria-label={t("coloring.category")}
												data={categoryOptions}
												value={row.categoryId ?? null}
												disabled={locked}
												onChange={(value) =>
													updateRow(row.key, {
														categoryId: value ?? undefined,
													})
												}
												comboboxProps={{ withinPortal: true }}
											/>
										</Table.Td>
										<Table.Td>
											<Select
												size="xs"
												aria-label={t("coloring.nature")}
												data={natureOptions}
												value={row.natureId ?? null}
												disabled={locked}
												onChange={(value) =>
													updateRow(row.key, {
														natureId: value ?? undefined,
													})
												}
												comboboxProps={{ withinPortal: true }}
											/>
										</Table.Td>
										<Table.Td>
											<ParentSelect
												keywords={keywords}
												loading={keywordsLoading}
												value={row.parentId}
												disabled={locked}
												onChange={(value) =>
													updateRow(row.key, {
														parentId: value,
														parentTouched: true,
														error: undefined,
													})
												}
											/>
											{row.suggestedParent && !row.parentTouched && (
												<Text size="xs" c="dimmed" mt={4}>
													{t(
														`extract.suggested.${row.suggestedParent.relation}`,
														{ name: row.suggestedParent.name },
													)}
													{!row.parentId &&
														` ${t("extract.suggestedUnsaved", { name: row.suggestedParent.name })}`}
												</Text>
											)}
										</Table.Td>
										<Table.Td>
											{row.saved ? (
												<Badge color="sage" variant="light">
													{t(`extract.saved.${row.saved}`)}
												</Badge>
											) : (
												<Stack gap={4}>
													<Group gap={4} wrap="nowrap">
														<Tooltip
															label={t("extract.new")}
															withArrow
															openDelay={350}
														>
															<Button
																size="compact-xs"
																variant={suggested ? "light" : "filled"}
																disabled={locked}
																loading={row.saving === "new"}
																onClick={() => void save(row, "new")}
															>
																{t("extract.new")}
															</Button>
														</Tooltip>
														<Tooltip
															label={t("extract.alias")}
															withArrow
															openDelay={350}
														>
															<Button
																size="compact-xs"
																variant={
																	suggested === "alias" ? "filled" : "light"
																}
																disabled={locked || !row.parentId}
																loading={row.saving === "alias"}
																onClick={() => void save(row, "alias")}
															>
																{t("extract.alias")}
															</Button>
														</Tooltip>
														<Tooltip
															label={t("extract.version")}
															withArrow
															openDelay={350}
														>
															<Button
																size="compact-xs"
																variant={
																	suggested === "version" ? "filled" : "light"
																}
																disabled={locked || !row.parentId}
																loading={row.saving === "version"}
																onClick={() => void save(row, "version")}
															>
																{t("extract.version")}
															</Button>
														</Tooltip>
														<Tooltip
															label={t("extract.ignore")}
															withArrow
															openDelay={350}
														>
															<Button
																size="compact-xs"
																variant="subtle"
																color="gray"
																disabled={!!row.saving}
																onClick={() =>
																	setRows((current) =>
																		current.filter(
																			(item) => item.key !== row.key,
																		),
																	)
																}
															>
																{t("extract.ignore")}
															</Button>
														</Tooltip>
													</Group>
													{row.error && (
														<Text size="xs" c="red">
															{row.error}
														</Text>
													)}
												</Stack>
											)}
										</Table.Td>
									</Table.Tr>
								);
							})}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>
			)}
		</Stack>
	);
}
