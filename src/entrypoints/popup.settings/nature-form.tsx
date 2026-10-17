import {
	ActionIcon,
	Alert,
	Button,
	Group,
	Stack,
	Text,
	Textarea,
	TextInput,
	Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { Trash2 as IconTrash } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ColorInput } from "@/components/color-input";
import { FormPage } from "@/components/form-page";
import { useRefreshContentScript } from "@/hooks/useRefreshContentScript";
import { useIsModerator } from "@/lib/auth";
import { useLauncherWork } from "@/lib/launcher-frame/use-launcher-work";
import { offlineErrorMessage } from "@/lib/offline/errors";
import { lookupFormChanges } from "@/lib/offline/form-changes";
import {
	type NatureFormValues,
	useOfflineNatureMutations,
} from "@/lib/offline/hooks";
import type { KeywordNature } from "@/types/models";
import { LookupDeleteDialog } from "./lookup-delete-dialog";
import { PersonalColorEditor } from "./personal-color-editor";

export type NatureFormModesType = "add" | "edit" | undefined;

interface NatureFormProps extends React.HTMLAttributes<HTMLFormElement> {
	mode: NatureFormModesType;
	nature?: KeywordNature;
	onClose: () => void;
}

function NatureFormContent({
	mode,
	nature,
	onClose,
	...props
}: NatureFormProps) {
	const { t } = useTranslation();
	const isModerator = useIsModerator();
	const [personalDirty, setPersonalDirty] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const form = useForm<NatureFormValues>({
		initialValues: {
			nameEn: nature?.nameEn || "",
			nameAr: nature?.nameAr || "",
			color: nature?.color || "#000000",
			description: nature?.description || "",
		},
		validate: {
			color: (value) =>
				!/^#[0-9A-Fa-f]{6}$/.test(value) ? t("settings.invalidColor") : null,
		},
	});

	const refreshContent = useRefreshContentScript();
	const { createMutation, updateMutation, deleteMutation } =
		useOfflineNatureMutations();

	const handleSubmit = (values: NatureFormValues) => {
		if (!isModerator) return;
		const payload: NatureFormValues = {
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

		if (mode === "edit" && nature?.id) {
			const changes = lookupFormChanges(nature, payload);
			if (!changes) {
				onClose();
				return;
			}
			updateMutation.mutate(
				{ id: nature.id, ...changes, seenUpdatedAt: String(nature.updatedAt) },
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

	useLauncherWork({ dirty: (isModerator && form.isDirty()) || personalDirty });

	const isPending =
		createMutation.isPending ||
		updateMutation.isPending ||
		deleteMutation.isPending;

	return (
		<Stack gap="lg">
			{mode === "edit" && nature && (
				<PersonalColorEditor
					kind="nature"
					row={nature}
					onDirtyChange={setPersonalDirty}
				/>
			)}
			{isModerator && (
				<form onSubmit={form.onSubmit(handleSubmit)} {...props}>
					<Stack gap="xs" p="xs">
						<Text fw={600}>{t("settings.originalDetails")}</Text>
						<Text size="sm" c="dimmed">
							{t("settings.originalDetailsHint")}
						</Text>
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
							label={t("settings.originalColor")}
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
							<Alert color="red">
								{offlineErrorMessage(
									createMutation.error ?? updateMutation.error,
									t,
								)}
							</Alert>
						)}

						<Group justify="space-between" mt="md">
							{mode === "edit" ? (
								<Tooltip label={t("_.delete")} withArrow openDelay={350}>
									<ActionIcon
										aria-label={t("_.delete")}
										variant="transparent"
										color="red"
										size="lg"
										onClick={() => setDeleting(true)}
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
			)}
			{deleting && nature && (
				<LookupDeleteDialog
					kind="nature"
					id={nature.id}
					onClose={() => setDeleting(false)}
					onDeleted={async () => {
						setDeleting(false);
						await refreshContent();
						form.reset();
						onClose();
					}}
				/>
			)}
		</Stack>
	);
}

export function NatureForm(props: Parameters<typeof NatureFormContent>[0]) {
	return (
		<FormPage title="NatureForm" onClose={props.onClose}>
			<NatureFormContent {...props} />
		</FormPage>
	);
}
