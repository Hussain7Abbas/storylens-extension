/** Nature marker diameter in pixels; independent of tooltip text size. */
export const NATURE_CIRCLE_SIZE_KEY = "storylens-nature-circle-size";
export const NATURE_CIRCLE_SIZE_MIN = 2;
export const NATURE_CIRCLE_SIZE_MAX = 16;
export const NATURE_CIRCLE_SIZE_DEFAULT = 6;
export function parseNatureCircleSize(value: unknown): number {
	return typeof value === "number" &&
		Number.isInteger(value) &&
		value >= NATURE_CIRCLE_SIZE_MIN &&
		value <= NATURE_CIRCLE_SIZE_MAX
		? value
		: NATURE_CIRCLE_SIZE_DEFAULT;
}
/** Existing markers inherit this property, so changing size never rebuilds page text. */
export function setNatureCircleSize(value: unknown): void {
	document.documentElement.style.setProperty(
		"--storylens-nature-circle-size",
		`${parseNatureCircleSize(value)}px`,
		"important",
	);
}
