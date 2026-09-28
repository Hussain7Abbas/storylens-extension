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
	Text,
	TextInput,
	Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
	Tags as IconCategory,
	Drama as IconMasksTheater,
	Trash2 as IconTrash,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	GetKeywords200DataItem,
	GetKeywords200DataItemAliasesItem,
	GetKeywords200DataItemVersionsItem,
	PostKeywordAliasesBodyOne,
	PostKeywordsBodyOne,
	PostKeywordVersionsBodyOne,
	PutKeywordAliasesByIdBodyOne,
	PutKeywordsByIdBodyOne,
	PutKeywordVersionsByIdBodyOne,
} from "@/api/generated/schemas";
import { FormPage } from "@/components/form-page";
import { GenerateImageButton } from "@/components/generate-image-button";
import { useIsModerator } from "@/lib/auth";
import type { KeywordSuggestion } from "@/lib/desktop-client/keyword-suggestion";
import {
	useOfflineKeywordAliasMutations,
	useOfflineKeywordCategories,
	useOfflineKeywordMutations,
	useOfflineKeywordNatures,
	useOfflineKeywordVersionMutations,
} from "@/lib/offline/hooks";
import type { KeywordCategory, KeywordNature } from "@/types/models";
import { uploadImageFile } from "@/utils/upload-image-file";

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

// ─── KEYWORD form ────────────────────────────────────────────────────────────

type KeywordFormValues = {
	name: string;
	matchingType: "FULL" | "PARTIAL";
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
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [imageFile, setImageFile] = useState<File | null>(null);
	const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
	const [isUploadingImage, setIsUploadingImage] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [isGeneratingImage, setIsGeneratingImage] = useState(false);

	const keyword = "keyword" in frame ? frame.keyword : undefined;
	const suggestion =
		frame.mode === "keyword-add" ? frame.suggestion : undefined;

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

	const form = useForm<KeywordFormValues>({
		initialValues: {
			name:
				keyword?.name ??
				(frame.mode === "keyword-add" ? (frame.initialText ?? "") : ""),
			matchingType: keyword?.matchingType ?? "FULL",
			categoryId: baseVersion?.categoryId ?? suggestion?.categoryId ?? "",
			natureId: baseVersion?.natureId ?? suggestion?.natureId ?? "",
			description: baseVersion?.description ?? suggestion?.description ?? "",
			imageId: (baseVersion?.imageId as string | undefined) ?? undefined,
		},
		validate: {
			name: (v) => (!v ? t("home.nameRequired") : null),
			categoryId: (v) => (!v ? t("home.categoryRequired") : null),
			natureId: (v) => (!v ? t("home.natureRequired") : null),
		},
	});

	const isPending =
		isGeneratingImage ||
		isUploadingImage ||
		createMutation.isPending ||
		updateMutation.isPending ||
		updateVersionMutation.isPending ||
		deleteMutation.isPending;

	const handleSubmit = async (values: KeywordFormValues) => {
		setUploadError(null);
		let imageId = values.imageId;
		if (imageFile) {
			setIsUploadingImage(true);
			try {
				imageId = await uploadImageFile(imageFile);
			} catch (error) {
				setUploadError(
					error instanceof Error
						? error.message
						: t("coloring.imageUploadFailed"),
				);
				return;
			} finally {
				setIsUploadingImage(false);
			}
		}

		if (frame.mode === "keyword-add") {
			const payload: PostKeywordsBodyOne = {
				novelId: selectedNovelId,
				name: values.name,
				matchingType: values.matchingType,
				categoryId: values.categoryId,
				natureId: values.natureId,
				description: values.description || undefined,
				imageId,
			};
			createMutation.mutate(payload, {
				onSuccess: () => {
					form.reset();
					setImageFile(null);
					onClose();
				},
			});
		} else if (keyword) {
			try {
				await updateMutation.mutateAsync({
					id: keyword.id,
					data: {
						name: values.name,
						matchingType: values.matchingType,
					} satisfies PutKeywordsByIdBodyOne,
				});
				if (baseVersion) {
					await updateVersionMutation.mutateAsync({
						id: baseVersion.id,
						data: {
							description: values.description || undefined,
							categoryId: values.categoryId || undefined,
							natureId: values.natureId || undefined,
							imageId,
						} satisfies PutKeywordVersionsByIdBodyOne,
					});
				}
				form.reset();
				setImageFile(null);
				onClose();
			} catch {
				// errors shown via mutation.isError below
			}
		}
	};

	const displayedImageUrl = imagePreviewUrl ?? baseVersion?.image?.url ?? null;

	return (
		<Stack gap="xs" p="xs">
			<form onSubmit={form.onSubmit(handleSubmit)}>
				<Stack gap="xs">
					<TextInput
						label={t("coloring.name")}
						{...form.getInputProps("name")}
						required
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
					<Select
						label={t("coloring.category")}
						placeholder={t("coloring.selectCategory")}
						allowDeselect={false}
						data={categoriesData?.map((cat: KeywordCategory) => ({
							value: cat.id,
							label: cat.nameEn || cat.nameAr || "",
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
							label: n.nameEn || n.nameAr || "",
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
						name={form.values.name}
						otherNames={keyword?.aliases.map((item) => item.name) ?? []}
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
							{t("coloring.createFailed")}: {createMutation.error?.message}
						</Alert>
					)}
					{(updateMutation.isError || updateVersionMutation.isError) && (
						<Alert color="red">
							{t("coloring.updateFailed")}:{" "}
							{(updateMutation.error ?? updateVersionMutation.error)?.message}
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
	name: string;
	description: string;
	matchingType: "FULL" | "PARTIAL";
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
	const [imageFile, setImageFile] = useState<File | null>(null);
	const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
	const [isUploadingImage, setIsUploadingImage] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [isGeneratingImage, setIsGeneratingImage] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const alias = "keyword" in frame ? frame.keyword : undefined;
	const suggestion = frame.mode === "alias-add" ? frame.suggestion : undefined;
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

	const displayedImageUrl = imagePreviewUrl ?? alias?.image?.url ?? null;

	const form = useForm<AliasFormValues>({
		initialValues: {
			name:
				alias?.name ??
				(frame.mode === "alias-add" ? (frame.initialText ?? "") : ""),
			description: alias?.description ?? suggestion?.description ?? "",
			matchingType: alias?.matchingType ?? "FULL",
			categoryId: alias?.categoryId ?? null,
			natureId: alias?.natureId ?? null,
			imageId: (alias?.imageId as string | undefined) ?? undefined,
			overrideStyle: alias?.overrideStyle ?? false,
		},
		validate: {
			name: (v) => (!v ? t("home.nameRequired") : null),
		},
	});

	const isPending =
		isGeneratingImage ||
		isUploadingImage ||
		createMutation.isPending ||
		updateMutation.isPending ||
		deleteMutation.isPending;

	const handleSubmit = async (values: AliasFormValues) => {
		setUploadError(null);
		let imageId = values.imageId;
		if (imageFile) {
			setIsUploadingImage(true);
			try {
				imageId = await uploadImageFile(imageFile);
			} catch (error) {
				setUploadError(
					error instanceof Error
						? error.message
						: t("coloring.imageUploadFailed"),
				);
				return;
			} finally {
				setIsUploadingImage(false);
			}
		}

		if (frame.mode === "alias-add") {
			const payload: PostKeywordAliasesBodyOne = {
				keywordId: frame.parentKeyword.id,
				name: values.name,
				description: values.description || undefined,
				matchingType: values.matchingType,
				categoryId: values.categoryId,
				natureId: values.natureId,
				imageId,
				overrideStyle: values.overrideStyle,
			};
			createMutation.mutate(payload, {
				onSuccess: () => {
					form.reset();
					onClose();
				},
			});
		} else if (alias) {
			const data: PutKeywordAliasesByIdBodyOne = {
				name: values.name,
				description: values.description || undefined,
				matchingType: values.matchingType,
				categoryId: values.categoryId,
				natureId: values.natureId,
				imageId,
				overrideStyle: values.overrideStyle,
			};
			updateMutation.mutate(
				{ id: alias.id, data },
				{
					onSuccess: () => {
						form.reset();
						onClose();
					},
				},
			);
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
							{frame.parentKeyword.name}
						</Text>
					</Text>
				</Group>
			</Alert>
			<form onSubmit={form.onSubmit(handleSubmit)}>
				<Stack gap="xs">
					<TextInput
						label={t("coloring.name")}
						{...form.getInputProps("name")}
						required
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
							label: cat.nameEn || cat.nameAr || "",
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
							label: n.nameEn || n.nameAr || "",
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
						name={form.values.name}
						otherNames={[frame.parentKeyword.name]}
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
					<Switch
						label={t("coloring.overrideStyle")}
						checked={form.values.overrideStyle}
						onChange={(e) =>
							form.setFieldValue("overrideStyle", e.currentTarget.checked)
						}
					/>
					{createMutation.isError && (
						<Alert color="red">
							{t("coloring.createFailed")}: {createMutation.error?.message}
						</Alert>
					)}
					{updateMutation.isError && (
						<Alert color="red">
							{t("coloring.updateFailed")}: {updateMutation.error?.message}
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
	const isModerator = useIsModerator();
	const [imageFile, setImageFile] = useState<File | null>(null);
	const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
	const [isUploadingImage, setIsUploadingImage] = useState(false);
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

	const isPending =
		isGeneratingImage ||
		isUploadingImage ||
		createMutation.isPending ||
		updateMutation.isPending ||
		deleteMutation.isPending;

	const handleSubmit = async (values: VersionFormValues) => {
		setUploadError(null);
		let imageId = values.imageId;
		if (imageFile) {
			setIsUploadingImage(true);
			try {
				imageId = await uploadImageFile(imageFile);
			} catch (error) {
				setUploadError(
					error instanceof Error
						? error.message
						: t("coloring.imageUploadFailed"),
				);
				return;
			} finally {
				setIsUploadingImage(false);
			}
		}

		if (frame.mode === "version-add") {
			const payload: PostKeywordVersionsBodyOne = {
				keywordId: frame.parentKeyword.id,
				categoryId: values.categoryId ?? undefined,
				natureId: values.natureId ?? undefined,
				description: values.description || undefined,
				imageId,
				currentChapter: currentChapter,
				...(isModerator && values.startingChapter !== undefined
					? { startingChapter: values.startingChapter }
					: {}),
				...(isModerator && values.endingChapter !== undefined
					? { endingChapter: values.endingChapter }
					: {}),
			};
			createMutation.mutate(payload, {
				onSuccess: () => {
					form.reset();
					setImageFile(null);
					onClose();
				},
			});
		} else if (version) {
			const data: PutKeywordVersionsByIdBodyOne = {
				description: values.description || undefined,
				categoryId: values.categoryId ?? undefined,
				natureId: values.natureId ?? undefined,
				imageId,
				...(isModerator && values.startingChapter !== undefined
					? { startingChapter: values.startingChapter }
					: {}),
				...(isModerator && values.endingChapter !== undefined
					? { endingChapter: values.endingChapter }
					: {}),
			};
			updateMutation.mutate(
				{ id: version.id, data },
				{
					onSuccess: () => {
						form.reset();
						setImageFile(null);
						onClose();
					},
				},
			);
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
						{frame.parentKeyword.name}
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
							label: cat.nameEn || cat.nameAr || "",
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
							label: n.nameEn || n.nameAr || "",
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
						name={frame.parentKeyword.name}
						otherNames={frame.parentKeyword.aliases.map((item) => item.name)}
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
							{t("coloring.createFailed")}: {createMutation.error?.message}
						</Alert>
					)}
					{updateMutation.isError && (
						<Alert color="red">
							{t("coloring.updateFailed")}: {updateMutation.error?.message}
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
