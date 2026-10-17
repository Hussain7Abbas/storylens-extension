import { isHexColor } from "@/lib/personal-colors/types";
export const KEYWORD_EFFECTS = [
	"NONE",
	"SPARKLES",
	"HEAT",
	"SHAKING",
	"GLITCHING",
	"GLARE",
] as const;
export type KeywordEffect = (typeof KEYWORD_EFFECTS)[number];

// Preserve the saved appearance preference across the move from category to word effects.
export const SHOW_WORD_VFX_KEY = "storylens-show-category-effects";
export function parseShowWordVfx(value: unknown): boolean {
	return value === true;
}
export function isKeywordEffect(value: unknown): value is KeywordEffect {
	return (
		typeof value === "string" &&
		KEYWORD_EFFECTS.some((effect) => effect === value)
	);
}
export function parseKeywordEffect(value: unknown): KeywordEffect {
	return isKeywordEffect(value) ? value : "NONE";
}

/** Only decorations that use the word's color offer a tint. */
export function hasWordVfxColor(value: unknown): boolean {
	return value === "SPARKLES" || value === "HEAT";
}
export function parseWordVfxColor(value: unknown): string | null {
	return isHexColor(value) && value.length === 7 ? value : null;
}

/** A word's own effect wins; NONE uses the category selected for this chapter. */
export function resolveWordVfx(
	word: { wordVfx?: unknown; wordVfxColor?: unknown },
	category: { wordVfx?: unknown; wordVfxColor?: unknown },
): { wordVfx: KeywordEffect; wordVfxColor: string | null } {
	const source = parseKeywordEffect(word.wordVfx) === "NONE" ? category : word;
	return {
		wordVfx: parseKeywordEffect(source.wordVfx),
		wordVfxColor: parseWordVfxColor(source.wordVfxColor),
	};
}
