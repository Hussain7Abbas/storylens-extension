import {
	ActionIcon,
	Alert,
	Button,
	Group,
	Stack,
	TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconTrash } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { ColorInput } from "@/components/color-input";
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

export function CategoryForm({
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
		const payload: CategoryFormValues = { ...values };

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

				{(createMutation.isError || updateMutation.isError) && (
					<Alert color="red">{t("settings.update")}</Alert>
				)}

				<Group justify="space-between" mt="md">
					{mode === "edit" ? (
						<ActionIcon
							variant="transparent"
							color="red"
							size="lg"
							onClick={handleDelete}
						>
							<IconTrash />
						</ActionIcon>
					) : (
						<span />
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
	);
}
