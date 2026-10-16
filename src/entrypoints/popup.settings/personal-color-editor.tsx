import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ColorInput } from "@/components/color-input";
import { currentUserAtom } from "@/lib/auth";
import { isHexColor, type LookupKind } from "@/lib/personal-colors/types";
import { usePersonalColors } from "@/lib/personal-colors/use-personal-colors";

function PersonalColorEditorContent({
	kind,
	row,
	onDirtyChange,
}: {
	kind: LookupKind;
	row: { id: string; color: string };
	onDirtyChange: (dirty: boolean) => void;
}) {
	const { t } = useTranslation();
	const preferences = usePersonalColors();
	const saved = preferences.colors[kind][row.id] ?? "";
	const [draft, setDraft] = useState<string | null>(null);
	const value = draft ?? saved;
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const [invalid, setInvalid] = useState(false);
	const dirty = value !== saved;
	useEffect(() => {
		onDirtyChange(dirty || busy);
	}, [dirty, busy, onDirtyChange]);
	const save = async (color: string | null) => {
		if (color !== null && !isHexColor(color)) {
			setInvalid(true);
			return;
		}
		setBusy(true);
		setFailed(false);
		setInvalid(false);
		try {
			await preferences.save({ kind, id: row.id, color });
			setDraft(null);
		} catch (error) {
			console.error("[StoryLens] Personal color save failed", error);
			setFailed(true);
		} finally {
			setBusy(false);
		}
	};
	return (
		<Stack gap="xs">
			<Text fw={600}>{t("settings.personalColor")}</Text>
			<Text size="sm" c="dimmed">
				{t("settings.personalColorHint")}
			</Text>
			<Text size="sm">
				{t("settings.originalColor")}: {row.color}
			</Text>
			<ColorInput
				label={t("settings.personalColor")}
				value={value}
				placeholder={row.color}
				onChange={setDraft}
				error={invalid ? t("settings.invalidColor") : undefined}
				disabled={preferences.isLoading || busy}
			/>
			<Group>
				<Button
					type="button"
					loading={busy}
					disabled={preferences.isLoading || !preferences.userId || !dirty}
					onClick={() => void save(value || null)}
				>
					{t("_.save")}
				</Button>
				<Button
					type="button"
					variant="subtle"
					disabled={busy || !saved}
					onClick={() => void save(null)}
				>
					{t("settings.clearPersonalColor")}
				</Button>
			</Group>
			{failed && (
				<Alert color="red">{t("settings.personalColorSaveFailed")}</Alert>
			)}
			{(preferences.pending[`${kind}/${row.id}`] || preferences.syncError) && (
				<Text size="sm" c="dimmed">
					{t("settings.personalColorPending")}
				</Text>
			)}
		</Stack>
	);
}

export function PersonalColorEditor(
	props: Parameters<typeof PersonalColorEditorContent>[0],
) {
	const user = useAtomValue(currentUserAtom);
	return (
		<PersonalColorEditorContent
			key={`${user?.id ?? ""}/${props.row.id}`}
			{...props}
		/>
	);
}
