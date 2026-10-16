import {
	Input,
	SegmentedControl,
	Select,
	Stack,
	Switch,
	Text,
	Title,
} from "@mantine/core";
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
import { parseTooltipTrigger } from "@/lib/tooltip-trigger";
import {
	FONT_FACE_OPTIONS,
	type FontFace,
	fontFaceAtom,
	fontSizeAtom,
	nightLightLevelAtom,
	showWordVfxAtom,
	tooltipTriggerAtom,
} from "@/store/appearance";
import { localeAtom } from "@/store/locale";

export function AppearanceTab() {
	const { t } = useTranslation();
	const [fontFace, setFontFace] = useAtom(fontFaceAtom);
	const [fontSize, setFontSize] = useAtom(fontSizeAtom);
	const [tooltipTrigger, setTooltipTrigger] = useAtom(tooltipTriggerAtom);
	const [nightLightLevel, setNightLightLevel] = useAtom(nightLightLevelAtom);
	const [showWordVfx, setShowWordVfx] = useAtom(showWordVfxAtom);
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

			<Input.Wrapper label={t("settings.appearance.showTooltip")}>
				<SegmentedControl
					fullWidth
					aria-label={t("settings.appearance.showTooltip")}
					value={tooltipTrigger}
					data={[
						{ value: "hover", label: t("settings.appearance.onHover") },
						{ value: "click", label: t("settings.appearance.onClick") },
					]}
					onChange={(value) => {
						const trigger = parseTooltipTrigger(value);
						setTooltipTrigger(trigger);
						trackEvent("tooltip_trigger_changed", { trigger });
					}}
				/>
			</Input.Wrapper>

			<Switch
				role="switch"
				label={t("settings.appearance.showWordVfx")}
				description={t("settings.appearance.wordVfxDescription")}
				checked={showWordVfx}
				onChange={(event) => {
					const enabled = event.currentTarget.checked;
					setShowWordVfx(enabled);
					trackEvent("word_vfx_visibility_changed", { enabled });
				}}
			/>

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
