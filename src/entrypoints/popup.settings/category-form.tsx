import {
	ActionIcon,
	Alert,
	Button,
	Group,
	Select,
	Stack,
	Switch,
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
import { trackEvent } from "@/lib/analytics/client";
import { useIsModerator } from "@/lib/auth";
import {
	hasWordVfxColor,
	KEYWORD_EFFECTS,
	parseKeywordEffect,
	parseWordVfxColor,
} from "@/lib/keyword-effects";
import { useLauncherWork } from "@/lib/launcher-frame/use-launcher-work";
import { offlineErrorMessage } from "@/lib/offline/errors";
import { lookupFormChanges } from "@/lib/offline/form-changes";
import {
	type CategoryFormValues,
	useOfflineCategoryMutations,
} from "@/lib/offline/hooks";
import type { KeywordCategory } from "@/types/models";
import { LookupDeleteDialog } from "./lookup-delete-dialog";
import { PersonalColorEditor } from "./personal-color-editor";

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
	const isModerator = useIsModerator();
	const [personalDirty, setPersonalDirty] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const form = useForm<CategoryFormValues>({
		initialValues: {
			nameEn: category?.nameEn || "",
			nameAr: category?.nameAr || "",
			color: category?.color || "#000000",
			description: category?.description || "",
			wordVfx: parseKeywordEffect(category?.wordVfx),
			switchPositionWithNature: category?.switchPositionWithNature ?? false,
			wordVfxColor: parseWordVfxColor(category?.wordVfxColor),
		},
		validate: {
			wordVfxColor: (value) =>
				value && !parseWordVfxColor(value) ? t("settings.invalidColor") : null,
			color: (value) =>
				!/^#[0-9A-Fa-f]{6}$/.test(value) ? t("settings.invalidColor") : null,
		},
	});

	const refreshContent = useRefreshContentScript();
	const { createMutation, updateMutation, deleteMutation } =
		useOfflineCategoryMutations();

	const handleSubmit = (values: CategoryFormValues) => {
		if (!isModerator) return;
		const payload: CategoryFormValues = {
			...values,
			wordVfxColor: values.wordVfxColor || null,
			// An empty value clears a saved description.
			description: values.description?.trim() || null,
		};

		if (mode === "add") {
			createMutation.mutate(payload, {
				onSuccess: async () => {
					if (
						(values.switchPositionWithNature ?? false) !==
						(category?.switchPositionWithNature ?? false)
					)
						trackEvent("category_position_changed", {
							switched: values.switchPositionWithNature === true,
						});
					await refreshContent();
					form.reset();
					onClose();
				},
			});
			return;
		}

		if (mode === "edit" && category?.id) {
			const changes = lookupFormChanges(category, payload);
			if (!changes) {
				onClose();
				return;
			}
			updateMutation.mutate(
				{
					id: category.id,
					...changes,
					seenUpdatedAt: String(category.updatedAt),
				},
				{
					onSuccess: async () => {
						if (
							(values.switchPositionWithNature ?? false) !==
							(category?.switchPositionWithNature ?? false)
						)
							trackEvent("category_position_changed", {
								switched: values.switchPositionWithNature === true,
							});
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
			{mode === "edit" && category && (
				<PersonalColorEditor
					kind="category"
					row={category}
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

						<Switch
							label={t("settings.switchPositionWithNature")}
							description={t("settings.switchPositionWithNatureHint")}
							{...form.getInputProps("switchPositionWithNature", {
								type: "checkbox",
							})}
						/>
						<Select
							label={t("coloring.wordVfx")}
							description={t("settings.categoryVfxHint")}
							data={KEYWORD_EFFECTS.map((value) => ({
								value,
								label: t(`settings.effects.${value}`),
							}))}
							allowDeselect={false}
							{...form.getInputProps("wordVfx")}
							onChange={(value) => {
								form.setFieldValue("wordVfx", parseKeywordEffect(value));
								if (!hasWordVfxColor(value))
									form.setFieldValue("wordVfxColor", null);
							}}
						/>
						{hasWordVfxColor(form.values.wordVfx) && (
							<ColorInput
								label={t("coloring.wordVfxColor")}
								description={t("coloring.wordVfxColorHint")}
								placeholder={t("coloring.inheritWordColor")}
								{...form.getInputProps("wordVfxColor")}
								value={form.values.wordVfxColor ?? ""}
								onChange={(value) =>
									form.setFieldValue("wordVfxColor", value || null)
								}
								rightSection={
									form.values.wordVfxColor ? (
										<ActionIcon
											type="button"
											variant="subtle"
											aria-label={t("coloring.inheritWordColor")}
											onClick={() => form.setFieldValue("wordVfxColor", null)}
										>
											<IconTrash size={14} aria-hidden />
										</ActionIcon>
									) : undefined
								}
							/>
						)}

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
			{deleting && category && (
				<LookupDeleteDialog
					kind="category"
					id={category.id}
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

export function CategoryForm(props: Parameters<typeof CategoryFormContent>[0]) {
	return (
		<FormPage title="CategoryForm" onClose={props.onClose}>
			<CategoryFormContent {...props} />
		</FormPage>
	);
}
