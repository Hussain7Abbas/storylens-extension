import { NumberInput, Select, Stack, Text, Title } from "@mantine/core";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import {
	FONT_FACE_OPTIONS,
	type FontFace,
	fontFaceAtom,
	fontSizeAtom,
} from "@/store/appearance";

export function AppearanceTab() {
	const { t } = useTranslation();
	const [fontFace, setFontFace] = useAtom(fontFaceAtom);
	const [fontSize, setFontSize] = useAtom(fontSizeAtom);

	return (
		<Stack gap="md" pt="md">
			<div>
				<Title order={6} mb="xs">
					{t("settings.appearance.title")}
				</Title>
				<Text size="sm" c="dimmed" mb="md">
					{t("settings.appearance.description")}
				</Text>
			</div>

			<Select
				label={t("settings.appearance.fontFace")}
				data={FONT_FACE_OPTIONS.map((f) => ({
					value: f,
					label: f === "Default" ? t("settings.appearance.fontDefault") : f,
				}))}
				value={fontFace}
				onChange={(val) => {
					if (val) setFontFace(val as FontFace);
				}}
			/>

			<NumberInput
				label={t("settings.appearance.fontSize")}
				min={10}
				max={22}
				step={1}
				value={fontSize}
				onChange={(val) => {
					if (typeof val === "number") setFontSize(val);
				}}
				suffix="px"
			/>
		</Stack>
	);
}
