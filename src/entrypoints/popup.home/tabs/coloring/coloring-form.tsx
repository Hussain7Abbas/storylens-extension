import {
	ActionIcon,
	Alert,
	Badge,
	Button,
	FileInput,
	Group,
	Image,
	Loader,
	Select,
	Stack,
	Switch,
	Text,
	TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconCategory, IconMasksTheater, IconTrash } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	GetKeywords200DataItem,
	PostKeywordsBodyOne,
	PutKeywordsByIdBodyOne,
} from "@/api/generated/schemas";
import {
	useOfflineKeywordCategories,
	useOfflineKeywordMutations,
	useOfflineKeywordNatures,
} from "@/lib/offline/hooks";
import type { KeywordCategory, KeywordNature } from "@/types/models";
import { uploadImageFile } from "@/utils/upload-image-file";

export type ColoringFormModesType = "add" | "edit" | undefined;

type ColoringFormValues = PostKeywordsBodyOne & {
	matchingType: NonNullable<PostKeywordsBodyOne["matchingType"]>;
};

interface ColoringFormProps extends React.HTMLAttributes<HTMLFormElement> {
	mode: ColoringFormModesType;
	selectedNovelId: string | undefined;
	keyword?: GetKeywords200DataItem;
	parentKeyword?: GetKeywords200DataItem;
	onClose: () => void;
}

export function ColoringForm({
	mode,
	selectedNovelId,
	keyword,
	parentKeyword,
	onClose,
	...props
}: ColoringFormProps) {
	const { t } = useTranslation();
	const [imageFile, setImageFile] = useState<File | null>(null);
	const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
	const [isUploadingImage, setIsUploadingImage] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);

	useEffect(() => {
		if (!imageFile) {
			setImagePreviewUrl(null);
			return;
		}

		const objectUrl = URL.createObjectURL(imageFile);
		setImagePreviewUrl(objectUrl);

		return () => {
			URL.revokeObjectURL(objectUrl);
		};
	}, [imageFile]);

	const displayedImageUrl = imagePreviewUrl ?? keyword?.image?.url ?? null;

	const effectiveParentId = parentKeyword?.id ?? keyword?.parentId ?? undefined;
	const isAliasDraft = mode === "add" && !!parentKeyword;

	const form = useForm<ColoringFormValues>({
		initialValues: {
			novelId: keyword?.novelId || "",
			name: keyword?.name || "",
			description: isAliasDraft
				? parentKeyword?.description || ""
				: keyword?.description || "",
			matchingType: isAliasDraft
				? (parentKeyword?.matchingType ?? "FULL")
				: (keyword?.matchingType ?? "FULL"),
			categoryId: isAliasDraft
				? parentKeyword?.categoryId || ""
				: keyword?.categoryId || "",
			natureId: isAliasDraft
				? parentKeyword?.natureId || ""
				: keyword?.natureId || "",
			imageId: keyword?.imageId || undefined,
			parentId: effectiveParentId,
		},
		validate: {
			name: (value) => (!value ? t("home.nameRequired") : null),
			description: (value) => (!value ? t("home.descriptionRequired") : null),
			categoryId: (value) => (!value ? t("home.categoryRequired") : null),
			natureId: (value) => (!value ? t("home.natureRequired") : null),
		},
	});

	const { data: categoriesData, isLoading: categoriesLoading } =
		useOfflineKeywordCategories();

	const { data: naturesData, isLoading: naturesLoading } =
		useOfflineKeywordNatures();

	const { createMutation, updateMutation, deleteMutation } =
		useOfflineKeywordMutations(selectedNovelId ?? "");

	const isAlias = !!effectiveParentId;

	const handleSubmit = async (values: typeof form.values) => {
		if (!selectedNovelId) {
			form.setFieldError("novel", t("home.selectNovelFirst"));
			return;
		}

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

		if (mode === "add") {
			createMutation.mutate(
				{
					...values,
					novelId: selectedNovelId,
					imageId,
					parentId: effectiveParentId,
				},
				{
					onSuccess: () => {
						form.reset();
						setImageFile(null);
						onClose();
					},
				},
			);
		} else if (mode === "edit" && keyword?.id) {
			const updateData: PutKeywordsByIdBodyOne = {
				name: values.name,
				description: values.description,
				matchingType: values.matchingType,
				categoryId: values.categoryId,
				natureId: values.natureId,
				imageId,
				parentId: effectiveParentId,
			};
			updateMutation.mutate(
				{
					id: keyword.id,
					data: updateData,
				},
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

	const handleDelete = () => {
		if (keyword?.id) {
			deleteMutation.mutate(keyword.id, {
				onSuccess: () => {
					form.reset();
					onClose();
				},
			});
		}
	};

	const isPending =
		isUploadingImage ||
		createMutation.isPending ||
		updateMutation.isPending ||
		deleteMutation.isPending;

	return (
		<Stack gap="xs" p="xs">
			{isAlias && parentKeyword && (
				<Alert
					color="blue"
					variant="light"
					py="xs"
					styles={{ message: { fontSize: "var(--mantine-font-size-xs)" } }}
				>
					<Group gap="xs" wrap="nowrap">
						<Badge size="xs" color="blue" variant="filled">
							{t("coloring.alias")}
						</Badge>
						<Text size="xs" c="dimmed" style={{ flex: 1 }}>
							{t("coloring.aliasOf")}:{" "}
							<Text component="span" fw={600} size="xs" c="blue">
								{parentKeyword.name}
							</Text>
						</Text>
					</Group>
				</Alert>
			)}

			<form onSubmit={form.onSubmit(handleSubmit)} {...props}>
				<Stack gap="xs">
					<TextInput
						label={t("coloring.name")}
						{...form.getInputProps("name")}
						required
					/>

					<Switch
						label={t("coloring.fullWordMatch")}
						checked={form.values.matchingType === "FULL"}
						onChange={(event) =>
							form.setFieldValue(
								"matchingType",
								event.currentTarget.checked ? "FULL" : "PARTIAL",
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
						leftSection={categoriesLoading ? <Loader /> : <IconCategory />}
						disabled={naturesLoading}
					/>

					<Select
						label={t("coloring.nature")}
						placeholder={t("coloring.selectNature")}
						allowDeselect={false}
						data={naturesData?.map((nature: KeywordNature) => ({
							value: nature.id,
							label: nature.nameEn || nature.nameAr || "",
						}))}
						{...form.getInputProps("natureId")}
						required
						leftSection={naturesLoading ? <Loader /> : <IconMasksTheater />}
						disabled={categoriesLoading}
					/>

					<TextInput
						label={t("coloring.description")}
						{...form.getInputProps("description")}
						required
					/>

					<FileInput
						label={t("coloring.image")}
						accept="image/*"
						value={imageFile}
						onChange={setImageFile}
						placeholder={t("coloring.imageOptional")}
						clearable
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
						justify={mode === "edit" ? "space-between" : "flex-end"}
						mt="md"
					>
						{mode === "edit" && (
							<ActionIcon
								variant="transparent"
								color="red"
								size="lg"
								onClick={() => handleDelete()}
							>
								<IconTrash />
							</ActionIcon>
						)}
						<Group>
							<Button variant="outline" onClick={onClose}>
								{t("_.cancel")}
							</Button>
							<Button type="submit" loading={isPending}>
								{t("_.save")}
							</Button>
						</Group>
					</Group>
				</Stack>
			</form>
		</Stack>
	);
}
