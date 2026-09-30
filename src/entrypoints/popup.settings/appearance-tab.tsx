import { Select, Stack, Text, Title } from "@mantine/core";
import { useDebouncedCallback } from "@mantine/hooks";
import { useAtom, useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { LevelSlider } from "@/components/level-slider";
import { trackEvent } from "@/lib/analytics/client";
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from "@/lib/font-size";
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
import { localeAtom } from "@/store/locale";

export function AppearanceTab() {
	const { t } = useTranslation();
	const [fontFace, setFontFace] = useAtom(fontFaceAtom);
	const [fontSize, setFontSize] = useAtom(fontSizeAtom);
	const [nightLightLevel, setNightLightLevel] = useAtom(nightLightLevelAtom);
	const direction = useAtomValue(localeAtom) === "ar" ? "rtl" : "ltr";
	// One event per adjustment, not one per step of a drag or key press.
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

			<LevelSlider
				label={t("settings.appearance.fontSize")}
				direction={direction}
				min={FONT_SIZE_MIN}
				max={FONT_SIZE_MAX}
				value={fontSize}
				onChange={setFontSize}
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

			<LevelSlider
				label={t("settings.appearance.nightLightLevel")}
				direction={direction}
				min={NIGHT_LIGHT_MIN_LEVEL}
				max={NIGHT_LIGHT_MAX_LEVEL}
				step={5}
				value={parseNightLightLevel(nightLightLevel)}
				onChange={(level) => {
					setNightLightLevel(level);
					trackNightLightLevel(level);
				}}
				suffix="%"
			/>
		</Stack>
	);
}
