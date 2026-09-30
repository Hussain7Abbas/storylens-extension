import { NumberInput, Select, Stack, Text, Title } from "@mantine/core";
import { useDebouncedCallback } from "@mantine/hooks";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { trackEvent } from "@/lib/analytics/client";
import {
	NIGHT_LIGHT_MAX_LEVEL,
	NIGHT_LIGHT_MIN_LEVEL,
	parseNightLightLevel,
} from "@/lib/night-light";
import {
	FONT_FACE_OPTIONS,
	type FontFace,
	fontFaceAtom,
	fontSizeAtom,
	nightLightLevelAtom,
} from "@/store/appearance";

export function AppearanceTab() {
	const { t } = useTranslation();
	const [fontFace, setFontFace] = useAtom(fontFaceAtom);
	const [fontSize, setFontSize] = useAtom(fontSizeAtom);
	const [nightLightLevel, setNightLightLevel] = useAtom(nightLightLevelAtom);
	// One event per adjustment, not one per keystroke or stepper click.
	const trackNightLightLevel = useDebouncedCallback(
		(level: number) =>
			trackEvent("night_light_level_changed", {
				level: parseNightLightLevel(level),
			}),
		{ delay: 1000, flushOnUnmount: true },
	);

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

			<div>
				<Title order={6} mb="xs">
					{t("settings.appearance.nightLight")}
				</Title>
				<Text size="sm" c="dimmed">
					{t("settings.appearance.nightLightDescription")}
				</Text>
			</div>

			<NumberInput
				label={t("settings.appearance.nightLightLevel")}
				min={NIGHT_LIGHT_MIN_LEVEL}
				max={NIGHT_LIGHT_MAX_LEVEL}
				step={5}
				value={nightLightLevel}
				onChange={(val) => {
					if (typeof val !== "number") return;
					setNightLightLevel(val);
					trackNightLightLevel(val);
				}}
				suffix="%"
			/>
		</Stack>
	);
}
