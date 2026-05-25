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
import type {
	GetReplacements200DataItem,
	PostReplacementsBodyOne,
} from "@/api/schemas";
import { useOfflineReplacementMutations } from "@/lib/offline/hooks";

export type ReplacingFormModesType = "add" | "edit" | undefined;
interface ReplacingFormProps extends React.HTMLAttributes<HTMLFormElement> {
	mode: ReplacingFormModesType;
	selectedNovelId: string | undefined;
	replacement?: GetReplacements200DataItem;
	onClose: () => void;
}

export function ReplacingForm({
	mode,
	selectedNovelId,
	replacement,
	onClose,
	...props
}: ReplacingFormProps) {
	const { t } = useTranslation();
	const form = useForm<PostReplacementsBodyOne>({
		initialValues: {
			novelId: replacement?.novelId || "",
			from: replacement?.from || "",
			to: replacement?.to || "",
		},
		validate: {
			from: (value) => (!value ? t("replacing.fromRequired") : null),
			to: (value) => (!value ? t("replacing.toRequired") : null),
		},
	});

	const { createMutation, updateMutation, deleteMutation } =
		useOfflineReplacementMutations(selectedNovelId ?? "");

	const handleSubmit = (values: typeof form.values) => {
		if (!selectedNovelId) {
			form.setFieldError("novel", t("home.selectNovelFirst"));
			return;
		}

		if (mode === "add") {
			createMutation.mutate(
				{
					novelId: selectedNovelId,
					from: values.from,
					to: values.to,
				},
				{
					onSuccess: () => {
						form.reset();
						onClose();
					},
				},
			);
		} else if (mode === "edit" && replacement?.id) {
			updateMutation.mutate(
				{
					id: replacement.id,
					data: values,
				},
				{
					onSuccess: () => {
						form.reset();
						onClose();
					},
				},
			);
		}
	};

	const handleDelete = () => {
		if (replacement?.id) {
			deleteMutation.mutate(replacement.id, {
				onSuccess: () => {
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
					label={t("replacing.from")}
					{...form.getInputProps("from")}
					required
				/>

				<TextInput
					label={t("replacing.to")}
					{...form.getInputProps("to")}
					required
				/>

				{createMutation.isError && (
					<Alert color="red">
						{t("replacing.createFailed")}: {createMutation.error?.message}
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
