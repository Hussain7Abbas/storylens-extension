import {
	ActionIcon,
	Alert,
	Badge,
	Button,
	FileInput,
	Group,
	Image,
	Loader,
	NumberInput,
	Select,
	Stack,
	Switch,
	Tabs,
	Text,
	TextInput,
	Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
	Tags as IconCategory,
	Link2 as IconLink,
	Drama as IconMasksTheater,
	Trash2 as IconTrash,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	GetKeywords200DataItem,
	GetKeywords200DataItemAliasesItem,
	GetKeywords200DataItemVersionsItem,
} from "@/api/generated/schemas";
import { FormPage } from "@/components/form-page";
import { GenerateImageButton } from "@/components/generate-image-button";
import {
	TranslationLinkSelect,
	type TranslationOption,
} from "@/components/translation-link-select";
import { UnsentDependants } from "@/components/unsent-dependants";
import { trackEvent } from "@/lib/analytics/client";
import { useIsModerator } from "@/lib/auth";
import type { KeywordSuggestion } from "@/lib/desktop-client/keyword-suggestion";
import { useLauncherWork } from "@/lib/launcher-frame/use-launcher-work";
import { offlineErrorMessage } from "@/lib/offline/errors";
import {
	aliasFormChanges,
	keywordFormChanges,
	versionFormChanges,
} from "@/lib/offline/form-changes";
import {
	useOfflineKeywordAliasMutations,
	useOfflineKeywordCategories,
	useOfflineKeywordMutations,
	useOfflineKeywordNatures,
	useOfflineKeywordVersionMutations,
	useTranslationAliases,
	useTranslationKeywords,
} from "@/lib/offline/hooks";
import { useLanguage } from "@/store/locale";
import type { KeywordCategory, KeywordNature } from "@/types/models";
import { stripArabicDiacritics } from "@/utils/arabic";
import { loadFormValues } from "@/utils/form-baseline";
import {
	aliasMatchNames,
	displayNameIn,
	LANGUAGES,
	type Language,
	nameIn,
	nameKey,
} from "@/utils/translation";

type StackFrame =
	| {
			mode: "keyword-add";
			initialText?: string;
			suggestion?: KeywordSuggestion;
	  }
	| { mode: "keyword-edit"; keyword: GetKeywords200DataItem }
	| {
			mode: "alias-add";
			initialText?: string;
			suggestion?: KeywordSuggestion;
			parentKeyword: GetKeywords200DataItem;
	  }
	| {
			mode: "alias-edit";
			keyword: GetKeywords200DataItemAliasesItem;
			parentKeyword: GetKeywords200DataItem;
	  }
	| {
			mode: "version-add";
			initialText?: string;
			suggestion?: KeywordSuggestion;
			parentKeyword: GetKeywords200DataItem;
	  }
	| {
			mode: "version-edit";
			keyword: GetKeywords200DataItemVersionsItem;
			parentKeyword: GetKeywords200DataItem;
	  };

interface ColoringFormProps {
	frame: StackFrame;
	selectedNovelId: string;
	currentChapter: number | undefined;
	onClose: () => void;
}

/** Category name used in image prompts, preferring the English name. */
function categoryLabel(
	categories: KeywordCategory[] | undefined,
	categoryId: string | null,
): string | undefined {
	const category = categories?.find((item) => item.id === categoryId);
	return category ? category.nameEn || category.nameAr || undefined : undefined;
}

/** The tab beside the reader's own language: the one that carries **Link**. */
function otherLanguage(language: Language): Language {
	return language === "ar" ? "en" : "ar";
}

/** Everything a linked row hands over: its own name and the shared style. */
type Translation = {
	name: string;
	description: string;
	categoryId: string | null;
	natureId: string | null;
	imageId: string | null;
	imageUrl: string | null;
};

type Styled = {
	description?: string | null;
	categoryId?: string | null;
	natureId?: string | null;
	imageId?: unknown;
	image?: { url?: string | null } | null;
};

function translationOf(
	named: { nameAr?: string | null; nameEn?: string | null },
	styled: Styled | undefined,
	language: Language,
): Translation {
	return {
		name: nameIn(named, language),
		description: styled?.description ?? "",
		categoryId: styled?.categoryId ?? null,
		natureId: styled?.natureId ?? null,
		imageId: (styled?.imageId as string | null | undefined) ?? null,
		imageUrl: styled?.image?.url ?? null,
	};
}

/** A keyword's style lives on its base version (the lowest starting chapter). */
function keywordTranslation(
	keyword: GetKeywords200DataItem,
	language: Language,
): Translation {
	const base = keyword.versions.length
		? [...keyword.versions].sort(
				(left, right) =>
					Number(left.startingChapter) - Number(right.startingChapter),
			)[0]
		: undefined;
	return translationOf(keyword, base, language);
}

function aliasTranslation(
	alias: GetKeywords200DataItemAliasesItem,
	language: Language,
): Translation {
	return translationOf(alias, alias, language);
}

/**
 * The language tabs of a keyword or alias form. Both tabs hold the same fields,
 * each with its own language's name; the reader's own language opens first, and
 * the other one also offers **Link**, and its label shows a link icon while one
 * is chosen.
 */
function LanguageTabs({
	language,
	tab,
	onTab,
	linked,
	fields,
}: {
	/** The reader's language: the tab that opens first. */
	language: Language;
	tab: Language;
	onTab: (tab: Language) => void;
	linked: boolean;
	fields: (tab: Language) => ReactNode;
}) {
	const { t } = useTranslation();
	const panelId = useId();
	return (
		<Tabs value={tab} onChange={(value) => onTab(value === "en" ? "en" : "ar")}>
			<Tabs.List grow>
				{LANGUAGES.map((item) => (
					<Tabs.Tab
						key={item}
						value={item}
						aria-controls={panelId}
						aria-label={t(
							item === "ar" ? "coloring.arabic" : "coloring.english",
						)}
						rightSection={
							item !== language && linked ? (
								<IconLink size={12} aria-hidden />
							) : undefined
						}
					>
						<Text span size="sm" fw={600}>
							{item.toUpperCase()}
						</Text>
					</Tabs.Tab>
				))}
			</Tabs.List>
			{/* Reuse one panel so shared controls keep running work across tab switches. */}
			<Tabs.Panel id={panelId} value={tab} pt="xs">
				<Stack gap="xs">{fields(tab)}</Stack>
			</Tabs.Panel>
		</Tabs>
	);
}

// ─── KEYWORD form ────────────────────────────────────────────────────────────

type KeywordFormValues = {
	/** One name per language tab; at least one is required, as the API asks. */
	nameAr: string;
	nameEn: string;
	matchingType: "FULL" | "PARTIAL";
	fuzzyMatchArabicCharacters: boolean;
	categoryId: string;
	natureId: string;
	description: string;
	imageId?: string;
};

function KeywordForm({
	frame,
	selectedNovelId,
	onClose,
}: {
	frame: Extract<StackFrame, { mode: "keyword-add" | "keyword-edit" }>;
	selectedNovelId: string;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const language = useLanguage();
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [imageFile, setImageFile] = useState<File | null>(null);
	const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [isGeneratingImage, setIsGeneratingImage] = useState(false);

	const keyword = "keyword" in frame ? frame.keyword : undefined;
	const suggestion =
		frame.mode === "keyword-add" ? frame.suggestion : undefined;
	// A keyword the AI matched in the other language starts the form linked.
	const suggestedTranslation =
		suggestion?.translation?.kind === "keyword"
			? suggestion.translation.id
			: undefined;
	const [translationId, setTranslationId] = useState<string | null>(
		suggestedTranslation ?? null,
	);
	const [linkedImageUrl, setLinkedImageUrl] = useState<string | null>(null);
	// The reader's own language opens first; the other tab carries Link.
	const other = otherLanguage(language);
	const [tab, setTab] = useState<Language>(language);

	const baseVersion = keyword?.versions.length
		? [...keyword.versions].sort(
				(a, b) => Number(a.startingChapter) - Number(b.startingChapter),
			)[0]
		: undefined;

	const { createMutation, updateMutation, deleteMutation } =
		useOfflineKeywordMutations(selectedNovelId);
	const { updateMutation: updateVersionMutation } =
		useOfflineKeywordVersionMutations(selectedNovelId);

	const { data: categoriesData, isLoading: categoriesLoading } =
		useOfflineKeywordCategories();
	const { data: naturesData, isLoading: naturesLoading } =
		useOfflineKeywordNatures();
	useEffect(() => {
		if (!imageFile) {
			setImagePreviewUrl(null);
			return;
		}
		const url = URL.createObjectURL(imageFile);
		setImagePreviewUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [imageFile]);

	// A picked word seeds the reader's own language; the other tab starts empty.
	const pickedName =
		frame.mode === "keyword-add"
			? stripArabicDiacritics(frame.initialText ?? "")
			: "";
	const storedName = (item: Language) =>
		keyword ? nameIn(keyword, item) : item === language ? pickedName : "";
	/** The other tab's saved name, restored when a link is cleared. */
	const storedOther = keyword ? nameIn(keyword, other) : "";
	/**
	 * The API needs a name before the merge runs, and a link sends the stored name
	 * rather than the one it shows, so one of the two saved names must be there.
	 */
	const missingName = (values: KeywordFormValues) =>
		values[nameKey(language)].trim() ||
		(translationId ? storedOther : values[nameKey(other)]).trim()
			? null
			: t("home.nameRequired");
	const form = useForm<KeywordFormValues>({
		initialValues: {
			nameAr: storedName("ar"),
			nameEn: storedName("en"),
			matchingType: keyword?.matchingType ?? "FULL",
			fuzzyMatchArabicCharacters: keyword?.fuzzyMatchArabicCharacters ?? true,
			categoryId: baseVersion?.categoryId ?? suggestion?.categoryId ?? "",
			natureId: baseVersion?.natureId ?? suggestion?.natureId ?? "",
			description: baseVersion?.description ?? suggestion?.description ?? "",
			imageId: (baseVersion?.imageId as string | undefined) ?? undefined,
		},
		validate: {
			nameAr: (_value, values) => missingName(values),
			nameEn: (_value, values) => missingName(values),
			categoryId: (v) => (!v ? t("home.categoryRequired") : null),
			natureId: (v) => (!v ? t("home.natureRequired") : null),
		},
	});

	// Link offers the novel's keywords named in the other tab's language and not
	// in the reader's: those are the ones this keyword can take a name from.
	const { keywords: translations, isLoading: translationsLoading } =
		useTranslationKeywords(selectedNovelId, {
			language: other,
			without: language,
			exceptId: keyword?.id,
			targetName: storedOther,
		});
	const translationOptions: TranslationOption[] = translations.map((item) => ({
		id: item.id,
		name: nameIn(item, other),
	}));

	useLauncherWork({ dirty: form.isDirty() || !!imageFile });

	const { setFieldValue, isDirty, resetDirty } = form;
	/**
	 * A link fills the other language's name and overwrites the shared style with
	 * the linked keyword's, because the merge keeps only one of the two rows.
	 * `baseline` is for a link the AI proposed: its values load without counting
	 * as unsaved changes. Clearing the link restores only the stored name.
	 */
	const applyTranslation = useCallback(
		(translation: Translation | null, baseline: boolean) => {
			const write = () => {
				setFieldValue(nameKey(other), translation?.name ?? storedOther);
				if (!translation) return;
				setFieldValue("description", translation.description);
				setFieldValue("categoryId", translation.categoryId ?? "");
				setFieldValue("natureId", translation.natureId ?? "");
				setFieldValue("imageId", translation.imageId ?? undefined);
				setImageFile(null);
				setLinkedImageUrl(translation.imageUrl);
			};
			if (baseline) loadFormValues({ isDirty, resetDirty }, write);
			else write();
		},
		[setFieldValue, isDirty, resetDirty, other, storedOther],
	);

	// The candidates load from the local view, so an AI-proposed link applies late.
	const appliedTranslation = useRef<string | null>(null);
	useEffect(() => {
		const source = translations.find(
			(item) => item.id === suggestedTranslation,
		);
		if (!source || appliedTranslation.current === source.id) return;
		appliedTranslation.current = source.id;
		applyTranslation(keywordTranslation(source, other), true);
	}, [suggestedTranslation, translations, applyTranslation, other]);

	const isPending =
		isGeneratingImage ||
		createMutation.isPending ||
		updateMutation.isPending ||
		updateVersionMutation.isPending ||
		deleteMutation.isPending;

	const handleSubmit = async (formValues: KeywordFormValues) => {
		setUploadError(null);
		// A link moves the other language's name over, so the form leaves that name
		// as it is stored: sending it would clash with the row the merge absorbs,
		// which still holds it (`assertKeywordNamesFree`).
		const values: KeywordFormValues = translationId
			? { ...formValues, [nameKey(other)]: storedOther }
			: formValues;
		// A picked or generated image is queued on the device and uploads with the change (U6).
		const image = imageFile
			? { blob: imageFile, name: imageFile.name, type: imageFile.type }
			: undefined;

		try {
			if (frame.mode === "keyword-add") {
				await createMutation.mutateAsync({
					// Each tab saves its own language's name; an empty tab saves nothing.
					nameAr: values.nameAr.trim() || null,
					nameEn: values.nameEn.trim() || null,
					matchingType: values.matchingType,
					fuzzyMatchArabicCharacters: values.fuzzyMatchArabicCharacters,
					categoryId: values.categoryId,
					natureId: values.natureId,
					description: values.description || null,
					imageId: values.imageId ?? null,
					image,
					// The linked keyword is merged in and gives this one its other name.
					translationKeywordId: translationId ?? undefined,
				});
			} else if (keyword) {
				const { keyword: keywordChanges, baseVersion: versionChanges } =
					keywordFormChanges(
						{
							nameAr: keyword.nameAr ?? "",
							nameEn: keyword.nameEn ?? "",
							matchingType: keyword.matchingType,
							fuzzyMatchArabicCharacters:
								keyword.fuzzyMatchArabicCharacters ?? true,
							categoryId: baseVersion?.categoryId ?? "",
							natureId: baseVersion?.natureId ?? "",
							description: baseVersion?.description ?? null,
							imageId: baseVersion?.imageId ?? null,
						},
						{ ...values, imageId: values.imageId ?? null },
					);
				if (keywordChanges || translationId) {
					await updateMutation.mutateAsync({
						id: keyword.id,
						changes: keywordChanges?.changes ?? {},
						seen: keywordChanges?.seen,
						seenUpdatedAt: String(keyword.updatedAt),
						translationKeywordId: translationId ?? undefined,
					});
				}
				if (baseVersion && (versionChanges || image)) {
					await updateVersionMutation.mutateAsync({
						id: baseVersion.id,
						changes: versionChanges?.changes ?? {},
						seen: versionChanges?.seen,
						seenUpdatedAt: String(baseVersion.updatedAt),
						image,
					});
				}
			}
			if (
				/\p{Script=Arabic}/u.test(values.nameAr + values.nameEn) &&
				(frame.mode === "keyword-add" ||
					(keyword?.fuzzyMatchArabicCharacters ?? true) !==
						values.fuzzyMatchArabicCharacters)
			) {
				trackEvent("keyword_arabic_match_saved", {
					kind: "keyword",
					enabled: values.fuzzyMatchArabicCharacters,
				});
			}
			if (translationId) {
				trackEvent("keyword_translation_linked", {
					kind: "keyword",
					source: translationId === suggestedTranslation ? "ai" : "manual",
				});
			}
			form.reset();
			setImageFile(null);
			onClose();
		} catch {
			// Refusals (permission, validation) show below from the mutation's error.
		}
	};

	const displayedImageUrl =
		imagePreviewUrl ?? linkedImageUrl ?? baseVersion?.image?.url ?? null;

	return (
		<Stack gap="xs" p="xs">
			<form onSubmit={form.onSubmit(handleSubmit)}>
				<Stack gap="xs">
					<LanguageTabs
						language={language}
						tab={tab}
						onTab={setTab}
						linked={!!translationId}
						fields={(item) => (
							<>
								{item !== language && (
									<TranslationLinkSelect
										options={translationOptions}
										value={translationId}
										onChange={(option) => {
											setTranslationId(option?.id ?? null);
											const source = translations.find(
												(row) => row.id === option?.id,
											);
											applyTranslation(
												source ? keywordTranslation(source, other) : null,
												false,
											);
										}}
										isLoading={translationsLoading}
									/>
								)}
								<TextInput
									label={t("coloring.name")}
									dir={item === "ar" ? "rtl" : "ltr"}
									lang={item}
									description={
										item !== language && translationId
											? t("coloring.linkedName")
											: undefined
									}
									disabled={item !== language && !!translationId}
									{...form.getInputProps(nameKey(item))}
								/>
								<Switch
									label={t("coloring.fullWordMatch")}
									checked={form.values.matchingType === "FULL"}
									onChange={(e) =>
										form.setFieldValue(
											"matchingType",
											e.currentTarget.checked ? "FULL" : "PARTIAL",
										)
									}
								/>
								{/\p{Script=Arabic}/u.test(
									form.values.nameAr + form.values.nameEn,
								) && (
									<Switch
										label={t("coloring.fuzzyMatchArabicCharacters")}
										description={t(
											"coloring.fuzzyMatchArabicCharactersDescription",
										)}
										{...form.getInputProps("fuzzyMatchArabicCharacters", {
											type: "checkbox",
										})}
									/>
								)}
								<Select
									label={t("coloring.category")}
									placeholder={t("coloring.selectCategory")}
									allowDeselect={false}
									data={categoriesData?.map((cat: KeywordCategory) => ({
										value: cat.id,
										label: displayNameIn(cat, language),
									}))}
									{...form.getInputProps("categoryId")}
									required
									leftSection={
										categoriesLoading ? (
											<Loader size="xs" />
										) : (
											<IconCategory size={16} />
										)
									}
								/>
								<Select
									label={t("coloring.nature")}
									placeholder={t("coloring.selectNature")}
									allowDeselect={false}
									data={naturesData?.map((n: KeywordNature) => ({
										value: n.id,
										label: displayNameIn(n, language),
									}))}
									{...form.getInputProps("natureId")}
									required
									leftSection={
										naturesLoading ? (
											<Loader size="xs" />
										) : (
											<IconMasksTheater size={16} />
										)
									}
								/>
								<TextInput
									label={t("coloring.description")}
									{...form.getInputProps("description")}
								/>
								<FileInput
									label={t("coloring.image")}
									accept="image/*"
									value={imageFile}
									onChange={setImageFile}
									placeholder={t("coloring.imageOptional")}
									clearable
								/>
								<GenerateImageButton
									novelId={selectedNovelId}
									name={nameIn(form.values, item)}
									otherNames={keyword?.aliases.flatMap(aliasMatchNames) ?? []}
									description={form.values.description}
									category={categoryLabel(
										categoriesData,
										form.values.categoryId,
									)}
									onGenerated={setImageFile}
									onBusyChange={setIsGeneratingImage}
								/>
								{displayedImageUrl && (
									<Image
										src={displayedImageUrl}
										alt={t("coloring.imagePreview")}
										radius="md"
										fit="contain"
										maw="16rem"
										mah="16rem"
										w="auto"
										style={{ alignSelf: "flex-start" }}
									/>
								)}
							</>
						)}
					/>
					{uploadError && <Alert color="red">{uploadError}</Alert>}
					{createMutation.isError && (
						<Alert color="red">
							{t("coloring.createFailed")}:{" "}
							{offlineErrorMessage(createMutation.error, t)}
						</Alert>
					)}
					{(updateMutation.isError || updateVersionMutation.isError) && (
						<Alert color="red">
							{t("coloring.updateFailed")}:{" "}
							{offlineErrorMessage(
								updateMutation.error ?? updateVersionMutation.error,
								t,
							)}
						</Alert>
					)}
					<Group
						justify={
							frame.mode === "keyword-edit" ? "space-between" : "flex-end"
						}
						mt="md"
					>
						{frame.mode === "keyword-edit" && !showDeleteConfirm && (
							<Tooltip label={t("_.delete")} withArrow openDelay={350}>
								<ActionIcon
									aria-label={t("_.delete")}
									variant="transparent"
									color="red"
									size="lg"
									onClick={() => setShowDeleteConfirm(true)}
								>
									<IconTrash />
								</ActionIcon>
							</Tooltip>
						)}
						<Group>
							<Tooltip label={t("_.cancel")} withArrow openDelay={350}>
								<Button variant="outline" onClick={onClose}>
									{t("_.cancel")}
								</Button>
							</Tooltip>
							<Tooltip label={t("_.save")} withArrow openDelay={350}>
								<Button type="submit" loading={isPending}>
									{t("_.save")}
								</Button>
							</Tooltip>
						</Group>
					</Group>
					{showDeleteConfirm && keyword && (
						<Alert color="red" variant="light">
							<Stack gap="xs">
								<Text size="sm">{t("home.confirmDelete")}</Text>
								<Text size="xs" c="dimmed">
									{t("coloring.deleteAliasesWarning")}
								</Text>
								<UnsentDependants entityId={keyword.id} />
								<Group grow>
									<Tooltip label={t("_.cancel")} withArrow openDelay={350}>
										<Button
											variant="outline"
											size="xs"
											onClick={() => setShowDeleteConfirm(false)}
											disabled={deleteMutation.isPending}
										>
											{t("_.cancel")}
										</Button>
									</Tooltip>
									<Tooltip label={t("_.delete")} withArrow openDelay={350}>
										<Button
											color="red"
											variant="outline"
											size="xs"
											onClick={() =>
												deleteMutation.mutate(keyword.id, {
													onSuccess: () => onClose(),
												})
											}
											loading={deleteMutation.isPending}
										>
											{t("_.delete")}
										</Button>
									</Tooltip>
								</Group>
							</Stack>
						</Alert>
					)}
				</Stack>
			</form>
		</Stack>
	);
}

// ─── ALIAS form ──────────────────────────────────────────────────────────────

type AliasFormValues = {
	nameAr: string;
	nameEn: string;
	description: string;
	matchingType: "FULL" | "PARTIAL";
	fuzzyMatchArabicCharacters: boolean;
	categoryId: string | null;
	natureId: string | null;
	imageId?: string;
	overrideStyle: boolean;
};

function AliasForm({
	frame,
	selectedNovelId,
	onClose,
}: {
	frame: Extract<StackFrame, { mode: "alias-add" | "alias-edit" }>;
	selectedNovelId: string;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const language = useLanguage();
	const [imageFile, setImageFile] = useState<File | null>(null);
	const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [isGeneratingImage, setIsGeneratingImage] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const alias = "keyword" in frame ? frame.keyword : undefined;
	const suggestion = frame.mode === "alias-add" ? frame.suggestion : undefined;
	// An alias the AI matched among the keyword's other-language aliases.
	const suggestedTranslation =
		suggestion?.translation?.kind === "alias"
			? suggestion.translation.id
			: undefined;
	const [translationId, setTranslationId] = useState<string | null>(
		suggestedTranslation ?? null,
	);
	const [linkedImageUrl, setLinkedImageUrl] = useState<string | null>(null);
	const other = otherLanguage(language);
	const [tab, setTab] = useState<Language>(language);
	const { createMutation, updateMutation, deleteMutation } =
		useOfflineKeywordAliasMutations(selectedNovelId);

	useEffect(() => {
		if (!imageFile) {
			setImagePreviewUrl(null);
			return;
		}
		const url = URL.createObjectURL(imageFile);
		setImagePreviewUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [imageFile]);

	const { data: categoriesData, isLoading: categoriesLoading } =
		useOfflineKeywordCategories();
	const { data: naturesData, isLoading: naturesLoading } =
		useOfflineKeywordNatures();
	const displayedImageUrl =
		imagePreviewUrl ?? linkedImageUrl ?? alias?.image?.url ?? null;

	const pickedName =
		frame.mode === "alias-add"
			? stripArabicDiacritics(frame.initialText ?? "")
			: "";
	const storedName = (item: Language) =>
		alias ? nameIn(alias, item) : item === language ? pickedName : "";
	/** The other tab's saved name, restored when a link is cleared. */
	const storedOther = alias ? nameIn(alias, other) : "";
	/** As in the keyword form: at least one of the two saved names is required. */
	const missingName = (values: AliasFormValues) =>
		values[nameKey(language)].trim() ||
		(translationId ? storedOther : values[nameKey(other)]).trim()
			? null
			: t("home.nameRequired");
	const form = useForm<AliasFormValues>({
		initialValues: {
			nameAr: storedName("ar"),
			nameEn: storedName("en"),
			description: alias?.description ?? suggestion?.description ?? "",
			matchingType: alias?.matchingType ?? "FULL",
			fuzzyMatchArabicCharacters: alias?.fuzzyMatchArabicCharacters ?? true,
			categoryId: alias?.categoryId ?? null,
			natureId: alias?.natureId ?? null,
			imageId: (alias?.imageId as string | undefined) ?? undefined,
			overrideStyle: alias?.overrideStyle ?? false,
		},
		validate: {
			nameAr: (_value, values) => missingName(values),
			nameEn: (_value, values) => missingName(values),
		},
	});

	// Link offers this keyword's other aliases named in the other tab's language.
	const { aliases: translations, isLoading: translationsLoading } =
		useTranslationAliases(selectedNovelId, frame.parentKeyword.id, {
			language: other,
			without: language,
			exceptId: alias?.id,
			targetName: storedOther,
		});
	const translationOptions: TranslationOption[] = translations.map((item) => ({
		id: item.id,
		name: nameIn(item, other),
	}));

	useLauncherWork({ dirty: form.isDirty() || !!imageFile });

	const { setFieldValue, isDirty, resetDirty } = form;
	/** As in the keyword form: a link fills the other name and the shared style. */
	const applyTranslation = useCallback(
		(translation: Translation | null, baseline: boolean) => {
			const write = () => {
				setFieldValue(nameKey(other), translation?.name ?? storedOther);
				if (!translation) return;
				setFieldValue("description", translation.description);
				setFieldValue("categoryId", translation.categoryId);
				setFieldValue("natureId", translation.natureId);
				setFieldValue("imageId", translation.imageId ?? undefined);
				setImageFile(null);
				setLinkedImageUrl(translation.imageUrl);
			};
			if (baseline) loadFormValues({ isDirty, resetDirty }, write);
			else write();
		},
		[setFieldValue, isDirty, resetDirty, other, storedOther],
	);

	// The siblings load from the local view, so an AI-proposed link applies late.
	const appliedTranslation = useRef<string | null>(null);
	useEffect(() => {
		const source = translations.find(
			(item) => item.id === suggestedTranslation,
		);
		if (!source || appliedTranslation.current === source.id) return;
		appliedTranslation.current = source.id;
		applyTranslation(aliasTranslation(source, other), true);
	}, [suggestedTranslation, translations, applyTranslation, other]);

	const isPending =
		isGeneratingImage ||
		createMutation.isPending ||
		updateMutation.isPending ||
		deleteMutation.isPending;

	const handleSubmit = async (formValues: AliasFormValues) => {
		setUploadError(null);
		// As in the keyword form: a link brings that language's name itself.
		const values: AliasFormValues = translationId
			? { ...formValues, [nameKey(other)]: storedOther }
			: formValues;
		const image = imageFile
			? { blob: imageFile, name: imageFile.name, type: imageFile.type }
			: undefined;
		try {
			if (frame.mode === "alias-add") {
				await createMutation.mutateAsync({
					keywordId: frame.parentKeyword.id,
					// One name per language tab, like keywords.
					nameAr: values.nameAr.trim() || null,
					nameEn: values.nameEn.trim() || null,
					description: values.description || null,
					matchingType: values.matchingType,
					fuzzyMatchArabicCharacters: values.fuzzyMatchArabicCharacters,
					categoryId: values.categoryId,
					natureId: values.natureId,
					imageId: values.imageId ?? null,
					overrideStyle: values.overrideStyle,
					image,
					// The linked sibling is merged in and gives this alias its other name.
					translationAliasId: translationId ?? undefined,
				});
			} else if (alias) {
				const initial = {
					nameAr: alias.nameAr ?? "",
					nameEn: alias.nameEn ?? "",
					description: alias.description ?? null,
					matchingType: alias.matchingType,
					fuzzyMatchArabicCharacters: alias.fuzzyMatchArabicCharacters ?? true,
					categoryId: alias.categoryId ?? null,
					natureId: alias.natureId ?? null,
					imageId: alias.imageId ?? null,
					overrideStyle: alias.overrideStyle,
				};
				const changes = aliasFormChanges(initial, {
					...values,
					imageId: values.imageId ?? null,
				});
				if (changes || image || translationId) {
					await updateMutation.mutateAsync({
						id: alias.id,
						changes: changes?.changes ?? {},
						seen: changes?.seen,
						seenUpdatedAt: String(alias.updatedAt),
						image,
						translationAliasId: translationId ?? undefined,
					});
				}
			}
			if (
				/\p{Script=Arabic}/u.test(values.nameAr + values.nameEn) &&
				(frame.mode === "alias-add" ||
					(alias?.fuzzyMatchArabicCharacters ?? true) !==
						values.fuzzyMatchArabicCharacters)
			) {
				trackEvent("keyword_arabic_match_saved", {
					kind: "alias",
					enabled: values.fuzzyMatchArabicCharacters,
				});
			}
			if (translationId) {
				trackEvent("keyword_translation_linked", {
					kind: "alias",
					source: translationId === suggestedTranslation ? "ai" : "manual",
				});
			}
			form.reset();
			setImageFile(null);
			onClose();
		} catch {
			// Refusals (permission, validation) show below from the mutation's error.
		}
	};

	return (
		<Stack gap="xs" p="xs">
			<Alert
				color="brand"
				variant="light"
				py="xs"
				styles={{ message: { fontSize: "var(--mantine-font-size-xs)" } }}
			>
				<Group gap="xs" wrap="nowrap">
					<Badge size="xs" color="brand" variant="filled">
						{t("coloring.alias")}
					</Badge>
					<Text size="xs" c="dimmed" style={{ flex: 1 }}>
						{t("coloring.aliasOf")}:{" "}
						<Text component="span" fw={600} size="xs" c="brand">
							{nameIn(frame.parentKeyword, language)}
						</Text>
					</Text>
				</Group>
			</Alert>
			<form onSubmit={form.onSubmit(handleSubmit)}>
				<Stack gap="xs">
					<LanguageTabs
						language={language}
						tab={tab}
						onTab={setTab}
						linked={!!translationId}
						fields={(item) => (
							<>
								{item !== language && (
									<TranslationLinkSelect
										options={translationOptions}
										value={translationId}
										onChange={(option) => {
											setTranslationId(option?.id ?? null);
											const source = translations.find(
												(row) => row.id === option?.id,
											);
											applyTranslation(
												source ? aliasTranslation(source, other) : null,
												false,
											);
										}}
										isLoading={translationsLoading}
									/>
								)}
								<TextInput
									label={t("coloring.name")}
									dir={item === "ar" ? "rtl" : "ltr"}
									lang={item}
									description={
										item !== language && translationId
											? t("coloring.linkedName")
											: undefined
									}
									disabled={item !== language && !!translationId}
									{...form.getInputProps(nameKey(item))}
								/>
								<Switch
									label={t("coloring.fullWordMatch")}
									checked={form.values.matchingType === "FULL"}
									onChange={(e) =>
										form.setFieldValue(
											"matchingType",
											e.currentTarget.checked ? "FULL" : "PARTIAL",
										)
									}
								/>
								{/\p{Script=Arabic}/u.test(
									form.values.nameAr + form.values.nameEn,
								) && (
									<Switch
										label={t("coloring.fuzzyMatchArabicCharacters")}
										description={t(
											"coloring.fuzzyMatchArabicCharactersDescription",
										)}
										{...form.getInputProps("fuzzyMatchArabicCharacters", {
											type: "checkbox",
										})}
									/>
								)}
								<TextInput
									label={t("coloring.description")}
									{...form.getInputProps("description")}
								/>
								<Select
									label={t("coloring.category")}
									placeholder={t("coloring.selectCategory")}
									clearable
									data={categoriesData?.map((cat: KeywordCategory) => ({
										value: cat.id,
										label: displayNameIn(cat, language),
									}))}
									{...form.getInputProps("categoryId")}
									leftSection={
										categoriesLoading ? (
											<Loader size="xs" />
										) : (
											<IconCategory size={16} />
										)
									}
								/>
								<Select
									label={t("coloring.nature")}
									placeholder={t("coloring.selectNature")}
									clearable
									data={naturesData?.map((n: KeywordNature) => ({
										value: n.id,
										label: displayNameIn(n, language),
									}))}
									{...form.getInputProps("natureId")}
									leftSection={
										naturesLoading ? (
											<Loader size="xs" />
										) : (
											<IconMasksTheater size={16} />
										)
									}
								/>
								<FileInput
									label={t("coloring.image")}
									accept="image/*"
									value={imageFile}
									onChange={setImageFile}
									placeholder={t("coloring.imageOptional")}
									clearable
								/>
								<GenerateImageButton
									novelId={selectedNovelId}
									name={nameIn(form.values, item)}
									otherNames={[nameIn(frame.parentKeyword, language)]}
									description={form.values.description}
									category={categoryLabel(
										categoriesData,
										form.values.categoryId,
									)}
									onGenerated={setImageFile}
									onBusyChange={setIsGeneratingImage}
								/>
								{displayedImageUrl && (
									<Image
										src={displayedImageUrl}
										alt={t("coloring.imagePreview")}
										radius="md"
										fit="contain"
										maw="16rem"
										mah="16rem"
										w="auto"
										style={{ alignSelf: "flex-start" }}
									/>
								)}
								<Switch
									label={t("coloring.overrideStyle")}
									checked={form.values.overrideStyle}
									onChange={(e) =>
										form.setFieldValue("overrideStyle", e.currentTarget.checked)
									}
								/>
							</>
						)}
					/>
					{uploadError && <Alert color="red">{uploadError}</Alert>}
					{createMutation.isError && (
						<Alert color="red">
							{t("coloring.createFailed")}:{" "}
							{offlineErrorMessage(createMutation.error, t)}
						</Alert>
					)}
					{updateMutation.isError && (
						<Alert color="red">
							{t("coloring.updateFailed")}:{" "}
							{offlineErrorMessage(updateMutation.error, t)}
						</Alert>
					)}
					<Group
						justify={frame.mode === "alias-edit" ? "space-between" : "flex-end"}
						mt="md"
					>
						{frame.mode === "alias-edit" && !showDeleteConfirm && (
							<Tooltip label={t("_.delete")} withArrow openDelay={350}>
								<ActionIcon
									aria-label={t("_.delete")}
									variant="transparent"
									color="red"
									size="lg"
									onClick={() => setShowDeleteConfirm(true)}
								>
									<IconTrash />
								</ActionIcon>
							</Tooltip>
						)}
						<Group>
							<Tooltip label={t("_.cancel")} withArrow openDelay={350}>
								<Button variant="outline" onClick={onClose}>
									{t("_.cancel")}
								</Button>
							</Tooltip>
							<Tooltip label={t("_.save")} withArrow openDelay={350}>
								<Button type="submit" loading={isPending}>
									{t("_.save")}
								</Button>
							</Tooltip>
						</Group>
					</Group>
					{showDeleteConfirm && alias && (
						<Alert color="red" variant="light">
							<Stack gap="xs">
								<Text size="sm">{t("home.confirmDelete")}</Text>
								<Group grow>
									<Tooltip label={t("_.cancel")} withArrow openDelay={350}>
										<Button
											variant="outline"
											size="xs"
											onClick={() => setShowDeleteConfirm(false)}
											disabled={deleteMutation.isPending}
										>
											{t("_.cancel")}
										</Button>
									</Tooltip>
									<Tooltip label={t("_.delete")} withArrow openDelay={350}>
										<Button
											color="red"
											variant="outline"
											size="xs"
											onClick={() =>
												deleteMutation.mutate(alias.id, {
													onSuccess: () => onClose(),
												})
											}
											loading={deleteMutation.isPending}
										>
											{t("_.delete")}
										</Button>
									</Tooltip>
								</Group>
							</Stack>
						</Alert>
					)}
				</Stack>
			</form>
		</Stack>
	);
}

// ─── VERSION form ─────────────────────────────────────────────────────────────

type VersionFormValues = {
	description: string;
	categoryId: string | null;
	natureId: string | null;
	imageId?: string;
	startingChapter?: number;
	endingChapter?: number | null;
};

function VersionForm({
	frame,
	selectedNovelId,
	currentChapter,
	onClose,
}: {
	frame: Extract<StackFrame, { mode: "version-add" | "version-edit" }>;
	selectedNovelId: string;
	currentChapter: number | undefined;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const language = useLanguage();
	const isModerator = useIsModerator();
	const [imageFile, setImageFile] = useState<File | null>(null);
	const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [isGeneratingImage, setIsGeneratingImage] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	const version = "keyword" in frame ? frame.keyword : undefined;
	const suggestion =
		frame.mode === "version-add" ? frame.suggestion : undefined;
	const { createMutation, updateMutation, deleteMutation } =
		useOfflineKeywordVersionMutations(selectedNovelId);

	const baseVersionId =
		frame.parentKeyword.versions.length > 0
			? [...frame.parentKeyword.versions].sort(
					(a, b) => Number(a.startingChapter) - Number(b.startingChapter),
				)[0]?.id
			: undefined;
	const isBaseVersion =
		frame.mode === "version-edit" && version?.id === baseVersionId;

	useEffect(() => {
		if (!imageFile) {
			setImagePreviewUrl(null);
			return;
		}
		const url = URL.createObjectURL(imageFile);
		setImagePreviewUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [imageFile]);

	const form = useForm<VersionFormValues>({
		initialValues: {
			description:
				version?.description ??
				suggestion?.description ??
				(frame.mode === "version-add" ? (frame.initialText ?? "") : ""),
			categoryId: version?.categoryId ?? suggestion?.categoryId ?? null,
			natureId: version?.natureId ?? suggestion?.natureId ?? null,
			imageId: (version?.imageId as string | undefined) ?? undefined,
			startingChapter: version ? Number(version.startingChapter) : undefined,
			endingChapter:
				version?.endingChapter != null
					? Number(version.endingChapter)
					: undefined,
		},
		validate: {
			categoryId: (v) =>
				isBaseVersion && !v ? t("home.categoryRequired") : null,
			natureId: (v) => (isBaseVersion && !v ? t("home.natureRequired") : null),
		},
	});

	const { data: categoriesData, isLoading: categoriesLoading } =
		useOfflineKeywordCategories();
	const { data: naturesData, isLoading: naturesLoading } =
		useOfflineKeywordNatures();

	const displayedImageUrl = imagePreviewUrl ?? version?.image?.url ?? null;

	useLauncherWork({ dirty: form.isDirty() || !!imageFile });

	const isPending =
		isGeneratingImage ||
		createMutation.isPending ||
		updateMutation.isPending ||
		deleteMutation.isPending;

	const handleSubmit = async (values: VersionFormValues) => {
		setUploadError(null);
		const image = imageFile
			? { blob: imageFile, name: imageFile.name, type: imageFile.type }
			: undefined;
		const range = isModerator
			? {
					startingChapter: values.startingChapter,
					endingChapter: values.endingChapter,
				}
			: {};
		try {
			if (frame.mode === "version-add") {
				await createMutation.mutateAsync({
					keywordId: frame.parentKeyword.id,
					categoryId: values.categoryId,
					natureId: values.natureId,
					description: values.description || null,
					imageId: values.imageId ?? null,
					currentChapter,
					...range,
					image,
				});
			} else if (version) {
				const changes = versionFormChanges(
					{
						categoryId: version.categoryId ?? null,
						natureId: version.natureId ?? null,
						description: version.description ?? null,
						imageId: version.imageId ?? null,
						...(isModerator
							? {
									startingChapter: Number(version.startingChapter),
									endingChapter:
										version.endingChapter == null
											? null
											: Number(version.endingChapter),
								}
							: {}),
					},
					{
						...values,
						imageId: values.imageId ?? null,
						...(isModerator
							? {
									startingChapter: values.startingChapter,
									endingChapter: values.endingChapter ?? null,
								}
							: {}),
					},
				);
				if (changes || image) {
					await updateMutation.mutateAsync({
						id: version.id,
						changes: changes?.changes ?? {},
						seen: changes?.seen,
						seenUpdatedAt: String(version.updatedAt),
						image,
					});
				}
			}
			form.reset();
			setImageFile(null);
			onClose();
		} catch {
			// Refusals (permission, validation) show below from the mutation's error.
		}
	};

	const startChapter = version
		? Number(version.startingChapter)
		: (currentChapter ?? 0);
	const endChapter =
		version?.endingChapter != null ? Number(version.endingChapter) : undefined;

	return (
		<Stack gap="xs" p="xs">
			<Alert
				color="lavender"
				variant="light"
				py="xs"
				styles={{ message: { fontSize: "var(--mantine-font-size-xs)" } }}
			>
				<Group gap="xs" wrap="nowrap">
					<Badge size="xs" color="lavender" variant="filled">
						{t("coloring.version")}
					</Badge>
					<Text size="xs" c="dimmed" style={{ flex: 1 }}>
						{nameIn(frame.parentKeyword, language)}
					</Text>
				</Group>
			</Alert>

			{/* Chapter range — always shown; editable only for admin */}
			<Group grow>
				<NumberInput
					label={t("coloring.startingChapter")}
					value={
						isModerator
							? (form.values.startingChapter ?? startChapter)
							: startChapter
					}
					readOnly={!isModerator}
					min={0}
					onChange={(v) =>
						isModerator &&
						form.setFieldValue(
							"startingChapter",
							typeof v === "number" ? v : undefined,
						)
					}
				/>
				<NumberInput
					label={t("coloring.endingChapter")}
					value={
						isModerator
							? (form.values.endingChapter ?? endChapter ?? undefined)
							: (endChapter ?? undefined)
					}
					readOnly={!isModerator}
					min={0}
					placeholder="∞"
					onChange={(v) =>
						isModerator &&
						form.setFieldValue(
							"endingChapter",
							typeof v === "number" ? v : null,
						)
					}
				/>
			</Group>

			<form onSubmit={form.onSubmit(handleSubmit)}>
				<Stack gap="xs">
					<Select
						label={t("coloring.category")}
						placeholder={t("coloring.selectCategory")}
						clearable={!isBaseVersion}
						allowDeselect={!isBaseVersion}
						data={categoriesData?.map((cat: KeywordCategory) => ({
							value: cat.id,
							label: displayNameIn(cat, language),
						}))}
						{...form.getInputProps("categoryId")}
						required={isBaseVersion}
						leftSection={
							categoriesLoading ? (
								<Loader size="xs" />
							) : (
								<IconCategory size={16} />
							)
						}
					/>
					<Select
						label={t("coloring.nature")}
						placeholder={t("coloring.selectNature")}
						clearable={!isBaseVersion}
						allowDeselect={!isBaseVersion}
						data={naturesData?.map((n: KeywordNature) => ({
							value: n.id,
							label: displayNameIn(n, language),
						}))}
						{...form.getInputProps("natureId")}
						required={isBaseVersion}
						leftSection={
							naturesLoading ? (
								<Loader size="xs" />
							) : (
								<IconMasksTheater size={16} />
							)
						}
					/>
					<TextInput
						label={t("coloring.description")}
						{...form.getInputProps("description")}
					/>
					<FileInput
						label={t("coloring.image")}
						accept="image/*"
						value={imageFile}
						onChange={setImageFile}
						placeholder={t("coloring.imageOptional")}
						clearable
					/>
					<GenerateImageButton
						novelId={selectedNovelId}
						name={nameIn(frame.parentKeyword, language)}
						otherNames={frame.parentKeyword.aliases.flatMap(aliasMatchNames)}
						description={form.values.description}
						category={categoryLabel(categoriesData, form.values.categoryId)}
						onGenerated={setImageFile}
						onBusyChange={setIsGeneratingImage}
					/>
					{displayedImageUrl && (
						<Image
							src={displayedImageUrl}
							alt={t("coloring.imagePreview")}
							radius="md"
							fit="contain"
							maw="16rem"
							mah="16rem"
							w="auto"
							style={{ alignSelf: "flex-start" }}
						/>
					)}
					{uploadError && <Alert color="red">{uploadError}</Alert>}
					{createMutation.isError && (
						<Alert color="red">
							{t("coloring.createFailed")}:{" "}
							{offlineErrorMessage(createMutation.error, t)}
						</Alert>
					)}
					{updateMutation.isError && (
						<Alert color="red">
							{t("coloring.updateFailed")}:{" "}
							{offlineErrorMessage(updateMutation.error, t)}
						</Alert>
					)}
					<Group
						justify={
							frame.mode === "version-edit" ? "space-between" : "flex-end"
						}
						mt="md"
					>
						{frame.mode === "version-edit" && !showDeleteConfirm && (
							<Tooltip label={t("_.delete")} withArrow openDelay={350}>
								<ActionIcon
									aria-label={t("_.delete")}
									variant="transparent"
									color="red"
									size="lg"
									onClick={() => setShowDeleteConfirm(true)}
								>
									<IconTrash />
								</ActionIcon>
							</Tooltip>
						)}
						<Group>
							<Tooltip label={t("_.cancel")} withArrow openDelay={350}>
								<Button variant="outline" onClick={onClose}>
									{t("_.cancel")}
								</Button>
							</Tooltip>
							<Tooltip label={t("_.save")} withArrow openDelay={350}>
								<Button type="submit" loading={isPending}>
									{t("_.save")}
								</Button>
							</Tooltip>
						</Group>
					</Group>
					{showDeleteConfirm && version && (
						<Alert color="red" variant="light">
							<Stack gap="xs">
								<Text size="sm">{t("home.confirmDelete")}</Text>
								<Group grow>
									<Tooltip label={t("_.cancel")} withArrow openDelay={350}>
										<Button
											variant="outline"
											size="xs"
											onClick={() => setShowDeleteConfirm(false)}
											disabled={deleteMutation.isPending}
										>
											{t("_.cancel")}
										</Button>
									</Tooltip>
									<Tooltip label={t("_.delete")} withArrow openDelay={350}>
										<Button
											color="red"
											variant="outline"
											size="xs"
											onClick={() =>
												deleteMutation.mutate(version.id, {
													onSuccess: () => onClose(),
												})
											}
											loading={deleteMutation.isPending}
										>
											{t("_.delete")}
										</Button>
									</Tooltip>
								</Group>
							</Stack>
						</Alert>
					)}
				</Stack>
			</form>
		</Stack>
	);
}

// ─── Router ───────────────────────────────────────────────────────────────────

function ColoringFormContent({
	frame,
	selectedNovelId,
	currentChapter,
	onClose,
}: ColoringFormProps) {
	if (frame.mode === "keyword-add" || frame.mode === "keyword-edit") {
		return (
			<KeywordForm
				frame={frame}
				selectedNovelId={selectedNovelId}
				onClose={onClose}
			/>
		);
	}
	if (frame.mode === "alias-add" || frame.mode === "alias-edit") {
		return (
			<AliasForm
				frame={frame}
				selectedNovelId={selectedNovelId}
				onClose={onClose}
			/>
		);
	}
	return (
		<VersionForm
			frame={frame}
			selectedNovelId={selectedNovelId}
			currentChapter={currentChapter}
			onClose={onClose}
		/>
	);
}

export function ColoringForm(props: Parameters<typeof ColoringFormContent>[0]) {
	return (
		<FormPage title="ColoringForm" onClose={props.onClose}>
			<ColoringFormContent {...props} />
		</FormPage>
	);
}
