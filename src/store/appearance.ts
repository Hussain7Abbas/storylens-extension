import { atomWithStorage } from "jotai/utils";
import {
	NIGHT_LIGHT_DEFAULT_LEVEL,
	NIGHT_LIGHT_LEVEL_KEY,
} from "@/lib/night-light";

export const APPEARANCE_FONT_FACE_KEY = "storylens-font-face";
export const APPEARANCE_FONT_SIZE_KEY = "storylens-font-size";

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

export const fontSizeAtom = atomWithStorage<number>(
	APPEARANCE_FONT_SIZE_KEY,
	14,
);

export const nightLightLevelAtom = atomWithStorage<number>(
	NIGHT_LIGHT_LEVEL_KEY,
	NIGHT_LIGHT_DEFAULT_LEVEL,
	undefined,
	{ getOnInit: true },
);
