// The launcher's Night light action. Free of React because the content script imports it.
export const NIGHT_LIGHT_ENABLED_KEY = "storylens-night-light";
export const NIGHT_LIGHT_LEVEL_KEY = "storylens-night-light-level";

/** Strength of the yellow layer, in percent. */
export const NIGHT_LIGHT_MIN_LEVEL = 10;
export const NIGHT_LIGHT_MAX_LEVEL = 80;
export const NIGHT_LIGHT_DEFAULT_LEVEL = 30;

const OVERLAY_ID = "storylens-night-light";
// A warm yellow; it is a light filter, not part of the Ink & Iris palette.
const TINT = "#ffc400";

/** The stored level, kept inside the supported range; anything else is the default. */
export function parseNightLightLevel(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value))
		return NIGHT_LIGHT_DEFAULT_LEVEL;
	return Math.min(
		Math.max(value, NIGHT_LIGHT_MIN_LEVEL),
		NIGHT_LIGHT_MAX_LEVEL,
	);
}

/** Shows, updates or removes the yellow layer over the page. */
export function setNightLightOverlay(enabled: boolean, level: number): void {
	const existing = document.getElementById(OVERLAY_ID);
	if (!enabled) {
		existing?.remove();
		return;
	}
	const overlay = existing ?? document.createElement("div");
	overlay.id = OVERLAY_ID;
	overlay.setAttribute("data-storylens-skip", "");
	overlay.setAttribute("aria-hidden", "true");
	// Multiply filters the page's own colors, so a dark page stays dark instead
	// of turning hazy. It only blends with the page from the root stacking
	// context, which is why the layer is not inside the launcher's shadow root.
	overlay.style.cssText = `all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;background:${TINT};opacity:${parseNightLightLevel(level) / 100};mix-blend-mode:multiply;`;
	// After <body>, so it also covers the launcher, its popup and the tooltips.
	if (!overlay.isConnected) document.documentElement.append(overlay);
}
