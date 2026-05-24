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
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
	useDeleteKeywordNaturesById,
	usePostKeywordNatures,
	usePutKeywordNaturesById,
} from "@/api/endpoints/keyword-natures.js";
import type { PostKeywordNaturesBodyOne } from "@/api/schemas";
import { useRefreshContentScript } from "@/hooks/useRefreshContentScript";
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

	const queryClient = useQueryClient();
	const refreshContent = useRefreshContentScript();

	const createMutation = usePostKeywordNatures({
		mutation: {
			onSuccess: async () => {
				queryClient.invalidateQueries({ queryKey: ["keyword-natures"] });
				await refreshContent();
				form.reset();
				onClose();
			},
		},
	});

	const updateMutation = usePutKeywordNaturesById({
		mutation: {
			onSuccess: async () => {
				queryClient.invalidateQueries({ queryKey: ["keyword-natures"] });
				await refreshContent();
				form.reset();
				onClose();
			},
		},
	});

	const deleteMutation = useDeleteKeywordNaturesById({
		mutation: {
			onSuccess: async () => {
				queryClient.invalidateQueries({ queryKey: ["keyword-natures"] });
				await refreshContent();
				form.reset();
				onClose();
			},
		},
	});

	const handleSubmit = (values: typeof form.values) => {
		if (mode === "add") {
			createMutation.mutate({ data: values });
			return;
		}

		if (mode === "edit" && nature?.id) {
			updateMutation.mutate({ id: nature.id, data: values });
		}
	};

	const handleDelete = () => {
		if (nature?.id) {
			deleteMutation.mutate({ id: nature.id });
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

				<TextInput
					label={t("settings.color")}
					placeholder="#FF0000"
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
