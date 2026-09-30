import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { FONT_SIZE_DEFAULT, parseFontSize } from "@/lib/font-size";
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
