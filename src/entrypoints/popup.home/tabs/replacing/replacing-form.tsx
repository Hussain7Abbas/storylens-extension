import {
	ActionIcon,
	Alert,
	Button,
	Group,
	Stack,
	Switch,
	TextInput,
	Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { Trash2 as IconTrash } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GetReplacements200DataItem } from "@/api/generated/schemas";
import { FormPage } from "@/components/form-page";
import { offlineErrorMessage } from "@/lib/offline/errors";
import { replacementFormChanges } from "@/lib/offline/form-changes";
import { useOfflineReplacementMutations } from "@/lib/offline/hooks";

export type ReplacingFormModesType = "add" | "edit" | undefined;

type ReplacingFormValues = {
	from: string;
	to: string;
	matchingType: "FULL" | "PARTIAL";
};
interface ReplacingFormProps extends React.HTMLAttributes<HTMLFormElement> {
	mode: ReplacingFormModesType;
	selectedNovelId: string | undefined;
	replacement?: GetReplacements200DataItem;
	initialText?: string;
	onClose: () => void;
}

function ReplacingFormContent({
	mode,
	selectedNovelId,
	replacement,
	initialText,
	onClose,
	...props
}: ReplacingFormProps) {
	const { t } = useTranslation();
	const form = useForm<ReplacingFormValues>({
		initialValues: {
			from: replacement?.from ?? (mode === "add" ? (initialText ?? "") : ""),
			to: replacement?.to || "",
			matchingType: replacement?.matchingType ?? "FULL",
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
					from: values.from,
					to: values.to,
					matchingType: values.matchingType,
				},
				{
					onSuccess: () => {
						form.reset();
						onClose();
					},
				},
			);
		} else if (mode === "edit" && replacement?.id) {
			const changes = replacementFormChanges(
				{
					from: replacement.from,
					to: replacement.to,
					matchingType: replacement.matchingType,
				},
				values,
			);
			if (!changes) {
				onClose();
				return;
			}
			updateMutation.mutate(
				{
					id: replacement.id,
					...changes,
					seenUpdatedAt: String(replacement.updatedAt),
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

				<Switch
					label={t("replacing.fullWordMatch")}
					checked={form.values.matchingType === "FULL"}
					onChange={(event) =>
						form.setFieldValue(
							"matchingType",
							event.currentTarget.checked ? "FULL" : "PARTIAL",
						)
					}
				/>

				<TextInput
					label={t("replacing.to")}
					{...form.getInputProps("to")}
					required
				/>

				{(createMutation.isError || updateMutation.isError) && (
					<Alert color="red">
						{t("replacing.createFailed")}:{" "}
						{offlineErrorMessage(
							createMutation.error ?? updateMutation.error,
							t,
						)}
					</Alert>
				)}

				<Group justify="space-between" mt="md">
					<Tooltip label={t("_.delete")} withArrow openDelay={350}>
						<ActionIcon
							aria-label={t("_.delete")}
							variant="transparent"
							color="red"
							size="lg"
							onClick={() => handleDelete()}
						>
							<IconTrash />
						</ActionIcon>
					</Tooltip>
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

export function ReplacingForm(
	props: Parameters<typeof ReplacingFormContent>[0],
) {
	return (
		<FormPage title="ReplacingForm" onClose={props.onClose}>
			<ReplacingFormContent {...props} />
		</FormPage>
	);
}
