import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { FONT_SIZE_DEFAULT, parseFontSize } from "@/lib/font-size";
import {
	parseShowCategoryEffects,
	SHOW_CATEGORY_EFFECTS_KEY,
} from "@/lib/keyword-effects";
import {
	NIGHT_LIGHT_DEFAULT_LEVEL,
	NIGHT_LIGHT_LEVEL_KEY,
} from "@/lib/night-light";
import {
	parseTooltipTrigger,
	TOOLTIP_TRIGGER_KEY,
	type TooltipTrigger,
} from "@/lib/tooltip-trigger";

export const APPEARANCE_FONT_FACE_KEY = "storylens-font-face";
export const APPEARANCE_FONT_SIZE_KEY = "storylens-font-size";

const storedShowCategoryEffectsAtom = atomWithStorage<boolean>(
	SHOW_CATEGORY_EFFECTS_KEY,
	false,
	undefined,
	{ getOnInit: true },
);
export const showCategoryEffectsAtom = atom(
	(get) => parseShowCategoryEffects(get(storedShowCategoryEffectsAtom)),
	(_get, set, visible: boolean) =>
		set(storedShowCategoryEffectsAtom, parseShowCategoryEffects(visible)),
);

const storedTooltipTriggerAtom = atomWithStorage<TooltipTrigger>(
	TOOLTIP_TRIGGER_KEY,
	"click",
	undefined,
	{ getOnInit: true },
);

export const tooltipTriggerAtom = atom(
	(get) => parseTooltipTrigger(get(storedTooltipTriggerAtom)),
	(_get, set, trigger: TooltipTrigger) =>
		set(storedTooltipTriggerAtom, parseTooltipTrigger(trigger)),
);

export const FONT_FACE_OPTIONS = [
	"Default",
	"Noto Kufi Arabic",
	"Arial",
	"Georgia",
	"Verdana",
	"Tahoma",
] as const;

export type FontFace = (typeof FONT_FACE_OPTIONS)[number];

export const fontFaceAtom = atomWithStorage<FontFace>(
	APPEARANCE_FONT_FACE_KEY,
	"Default",
);

const storedFontSizeAtom = atomWithStorage<number>(
	APPEARANCE_FONT_SIZE_KEY,
	FONT_SIZE_DEFAULT,
	undefined,
	{ getOnInit: true },
);

/** The tooltip font size, always inside the supported range. */
export const fontSizeAtom = atom(
	(get) => parseFontSize(get(storedFontSizeAtom)),
	(_get, set, size: number) => set(storedFontSizeAtom, parseFontSize(size)),
);

export const nightLightLevelAtom = atomWithStorage<number>(
	NIGHT_LIGHT_LEVEL_KEY,
	NIGHT_LIGHT_DEFAULT_LEVEL,
	undefined,
	{ getOnInit: true },
);
