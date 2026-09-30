// The keyword tooltip's font size. Free of React because the content script imports it.

/** Size of the tooltip text, in pixels. */
export const FONT_SIZE_MIN = 18;
export const FONT_SIZE_MAX = 42;
export const FONT_SIZE_DEFAULT = 24;

/**
 * The stored size. Anything outside the supported range is the default, which
 * includes sizes saved under the earlier 10 to 22 range and its default of 14.
 */
export function parseFontSize(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value))
		return FONT_SIZE_DEFAULT;
	if (value < FONT_SIZE_MIN || value > FONT_SIZE_MAX) return FONT_SIZE_DEFAULT;
	return value;
}
