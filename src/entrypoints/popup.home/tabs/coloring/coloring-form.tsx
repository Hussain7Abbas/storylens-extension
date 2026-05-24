import {
	ActionIcon,
	Alert,
	Button,
	FileInput,
	Group,
	Loader,
	Select,
	Stack,
	TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconCategory, IconMasksTheater, IconTrash } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type {
	GetKeywords200DataItem,
	PostKeywordsBodyOne,
} from "@/api/schemas";
import { useRefreshContentScript } from "@/hooks/useRefreshContentScript";
import {
	useOfflineKeywordCategories,
	useOfflineKeywordMutations,
	useOfflineKeywordNatures,
} from "@/lib/offline/hooks";
import type { KeywordCategory, KeywordNature } from "@/types/models";

export type ColoringFormModesType = "add" | "edit" | undefined;
interface ColoringFormProps extends React.HTMLAttributes<HTMLFormElement> {
	mode: ColoringFormModesType;
	selectedNovelId: string | undefined;
	keyword?: GetKeywords200DataItem;
	onClose: () => void;
}

export function ColoringForm({
	mode,
	selectedNovelId,
	keyword,
	onClose,
	...props
}: ColoringFormProps) {
	const { t } = useTranslation();
	const form = useForm<PostKeywordsBodyOne>({
		initialValues: {
			novelId: keyword?.novelId || "",
			name: keyword?.name || "",
			description: keyword?.description || "",
			categoryId: keyword?.categoryId || "",
			natureId: keyword?.natureId || "",
			imageId: keyword?.imageId || undefined,
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

	const refreshContent = useRefreshContentScript();
	const { createMutation, updateMutation, deleteMutation } =
		useOfflineKeywordMutations(selectedNovelId ?? "");

	const handleSubmit = (values: typeof form.values) => {
		if (!selectedNovelId) {
			form.setFieldError("novel", t("home.selectNovelFirst"));
			return;
		}
		if (mode === "add") {
			createMutation.mutate(
				{
					...values,
					novelId: selectedNovelId,
				},
				{
					onSuccess: async () => {
						await refreshContent();
						form.reset();
						onClose();
					},
				},
			);
		} else if (mode === "edit" && keyword?.id) {
			updateMutation.mutate(
				{
					id: keyword.id,
					data: values,
				},
				{
					onSuccess: async () => {
						await refreshContent();
						form.reset();
						onClose();
					},
				},
			);
		}
	};

	const handleDelete = () => {
		if (keyword?.id) {
			deleteMutation.mutate(keyword.id, {
				onSuccess: async () => {
					await refreshContent();
					form.reset();
					onClose();
				},
			});
		}
	};

	const isPending =
		createMutation.isPending ||
		updateMutation.isPending ||
		deleteMutation.isPending;

	return (
		<form onSubmit={form.onSubmit(handleSubmit)} {...props}>
			<Stack gap="xs" p="xs">
				<TextInput
					label={t("coloring.name")}
					{...form.getInputProps("name")}
					required
				/>

				<Select
					label={t("coloring.category")}
					placeholder={t("coloring.selectCategory")}
					allowDeselect={false}
					data={categoriesData?.map((cat: KeywordCategory) => ({
						value: cat.id,
						label: cat.name,
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
						label: nature.name,
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
					{...form.getInputProps("imageId")}
					placeholder={t("coloring.imageOptional")}
				/>

				{createMutation.isError && (
					<Alert color="red">
						{t("coloring.createFailed")}: {createMutation.error?.message}
					</Alert>
				)}

				<Group justify="space-between" mt="md">
					<ActionIcon
						variant="transparent"
						color="red"
						size="lg"
						onClick={() => handleDelete()}
					>
						<IconTrash />
					</ActionIcon>
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
	);
}
