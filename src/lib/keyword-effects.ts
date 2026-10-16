export const KEYWORD_EFFECTS = [
	"NONE",
	"SPARKLES",
	"HEAT",
	"SHAKING",
	"GLITCHING",
] as const;
export type KeywordEffect = (typeof KEYWORD_EFFECTS)[number];

export const SHOW_CATEGORY_EFFECTS_KEY = "storylens-show-category-effects";
export function parseShowCategoryEffects(value: unknown): boolean {
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
