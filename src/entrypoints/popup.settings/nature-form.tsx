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
import type { PostKeywordNaturesBodyOne } from "@/api/schemas";
import { ColorInput } from "@/components/color-input";
import { useRefreshContentScript } from "@/hooks/useRefreshContentScript";
import { useOfflineNatureMutations } from "@/lib/offline/hooks";
import type { KeywordNature } from "@/types/models";

export type NatureFormModesType = "add" | "edit" | undefined;

interface NatureFormProps extends React.HTMLAttributes<HTMLFormElement> {
	mode: NatureFormModesType;
	nature?: KeywordNature;
	onClose: () => void;
}

export function NatureForm({
	mode,
	nature,
	onClose,
	...props
}: NatureFormProps) {
	const { t } = useTranslation();
	const form = useForm<PostKeywordNaturesBodyOne>({
		initialValues: {
			name: nature?.name || "",
			color: nature?.color || "#000000",
		},
		validate: {
			name: (value) => (!value ? t("settings.nameRequired") : null),
			color: (value) =>
				!/^#[0-9A-Fa-f]{6}$/.test(value) ? t("settings.invalidColor") : null,
		},
	});

	const refreshContent = useRefreshContentScript();
	const { createMutation, updateMutation, deleteMutation } =
		useOfflineNatureMutations();

	const handleSubmit = (values: typeof form.values) => {
		if (mode === "add") {
			createMutation.mutate(values, {
				onSuccess: async () => {
					await refreshContent();
					form.reset();
					onClose();
				},
			});
			return;
		}

		if (mode === "edit" && nature?.id) {
			updateMutation.mutate(
				{ id: nature.id, data: values },
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
		if (nature?.id) {
			deleteMutation.mutate(nature.id, {
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
					label={t("settings.name")}
					{...form.getInputProps("name")}
					required
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
