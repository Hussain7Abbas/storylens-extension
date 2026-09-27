import {
	ActionIcon,
	Alert,
	Button,
	Group,
	Stack,
	Textarea,
	TextInput,
	Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { Trash2 as IconTrash } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ColorInput } from "@/components/color-input";
import { FormPage } from "@/components/form-page";
import { useRefreshContentScript } from "@/hooks/useRefreshContentScript";
import {
	type CategoryFormValues,
	useOfflineCategoryMutations,
} from "@/lib/offline/hooks";
import type { KeywordCategory } from "@/types/models";

export type CategoryFormModesType = "add" | "edit" | undefined;

interface CategoryFormProps extends React.HTMLAttributes<HTMLFormElement> {
	mode: CategoryFormModesType;
	category?: KeywordCategory;
	onClose: () => void;
}

function CategoryFormContent({
	mode,
	category,
	onClose,
	...props
}: CategoryFormProps) {
	const { t } = useTranslation();
	const form = useForm<CategoryFormValues>({
		initialValues: {
			nameEn: category?.nameEn || "",
			nameAr: category?.nameAr || "",
			color: category?.color || "#000000",
			description: category?.description || "",
		},
		validate: {
			color: (value) =>
				!/^#[0-9A-Fa-f]{6}$/.test(value) ? t("settings.invalidColor") : null,
		},
	});

	const refreshContent = useRefreshContentScript();
	const { createMutation, updateMutation, deleteMutation } =
		useOfflineCategoryMutations();

	const handleSubmit = (values: CategoryFormValues) => {
		const payload: CategoryFormValues = {
			...values,
			// An empty value clears a saved description.
			description: values.description?.trim() || null,
		};

		if (mode === "add") {
			createMutation.mutate(payload, {
				onSuccess: async () => {
					await refreshContent();
					form.reset();
					onClose();
				},
			});
			return;
		}

		if (mode === "edit" && category?.id) {
			updateMutation.mutate(
				{ id: category.id, data: payload },
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
		if (category?.id) {
			deleteMutation.mutate(category.id, {
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
					label={t("settings.nameEn")}
					{...form.getInputProps("nameEn")}
					required
				/>

				<TextInput
					label={t("settings.nameAr")}
					{...form.getInputProps("nameAr")}
					dir="rtl"
				/>

				<ColorInput
					label={t("settings.color")}
					{...form.getInputProps("color")}
					required
				/>

				<Textarea
					label={t("settings.description")}
					description={t("settings.descriptionHint")}
					autosize
					minRows={2}
					maxRows={5}
					maxLength={1000}
					{...form.getInputProps("description")}
				/>

				{(createMutation.isError || updateMutation.isError) && (
					<Alert color="red">{t("settings.update")}</Alert>
				)}

				<Group justify="space-between" mt="md">
					{mode === "edit" ? (
						<Tooltip label={t("_.delete")} withArrow openDelay={350}>
							<ActionIcon
								aria-label={t("_.delete")}
								variant="transparent"
								color="red"
								size="lg"
								onClick={handleDelete}
							>
								<IconTrash />
							</ActionIcon>
						</Tooltip>
					) : (
						<span />
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
			</Stack>
		</form>
	);
}

export function CategoryForm(props: Parameters<typeof CategoryFormContent>[0]) {
	return (
		<FormPage title="CategoryForm" onClose={props.onClose}>
			<CategoryFormContent {...props} />
		</FormPage>
	);
}
