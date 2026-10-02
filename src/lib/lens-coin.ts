import type { IconNode } from "lucide";

/**
 * The lens coin (umbrella `docs/branding/lens-coin/`) for code without React:
 * the line coin as a Lucide node for the launcher, and number formatting
 * shared with the React components.
 */
export const LENS_COIN_MONO: IconNode = [
	["circle", { cx: "12", cy: "12", r: "10" }],
	[
		"path",
		{
			d: "M12 6.5c.5 3 2.5 5 5.5 5.5-3 .5-5 2.5-5.5 5.5-.5-3-2.5-5-5.5-5.5 3-.5 5-2.5 5.5-5.5z",
		},
	],
];

/** Lens amounts use grouping and Latin digits in both languages, like the rest of the UI. */
export function formatLenses(lenses: number, locale: string): string {
	return new Intl.NumberFormat(
		locale.toLowerCase().startsWith("ar") ? "ar-u-nu-latn" : "en",
	).format(lenses);
}
