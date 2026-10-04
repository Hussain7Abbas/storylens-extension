import { createElement, type IconNode } from "lucide";

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

/** Mirrors umbrella docs/branding/lens-coin/motion.css for shadow-root UI. */
export const LENS_COIN_MOTION_CSS = `
/* Shared lens coin sparkles; canonical source: umbrella docs/branding/lens-coin. */
.lens-coin-static {
	position: relative;
	display: inline-flex;
	flex: none;
	vertical-align: middle;
	line-height: 0;
}
.lens-coin-artwork {
	display: inline-flex;
	width: 100%;
	height: 100%;
}
.lens-coin-static > .lens-coin-artwork > svg {
	width: 100%;
	height: 100%;
}
.lens-coin-static > .lens-coin-sparkles {
	position: absolute;
	inset: -12.5%;
	width: 125%;
	height: 125%;
	pointer-events: none;
	color: var(--accent, var(--mantine-primary-color-filled, currentColor));
}
.lens-coin-static[data-mono] > .lens-coin-sparkles {
	color: inherit;
}
.lens-coin-sparkles > path {
	opacity: 0;
	animation: lens-coin-twinkle 900ms ease-in-out infinite;
}
.lens-coin-sparkles > path:nth-child(2) {
	animation-delay: 300ms;
}
.lens-coin-sparkles > path:nth-child(3) {
	animation-delay: 600ms;
}
@keyframes lens-coin-twinkle {
	0%,
	33.333%,
	100% {
		opacity: 0;
	}
	16.667% {
		opacity: 0.85;
	}
}
:is(button, a):is(:hover, :focus-within) .lens-coin-sparkles > path {
	animation-play-state: paused;
}
@media (prefers-reduced-motion: reduce), (forced-colors: active) {
	.lens-coin-sparkles > path {
		animation: none;
		opacity: 0;
	}
}
`;

const LENS_COIN_SPARKLES: IconNode = [
	[
		"path",
		{
			d: "M26 0c.4 2.4 1.6 3.6 4 4-2.4.4-3.6 1.6-4 4-.4-2.4-1.6-3.6-4-4 2.4-.4 3.6-1.6 4-4z",
		},
	],
	[
		"path",
		{
			d: "M3 10c.3 1.8 1.2 2.7 3 3-1.8.3-2.7 1.2-3 3-.3-1.8-1.2-2.7-3-3 1.8-.3 2.7-1.2 3-3z",
		},
	],
	[
		"path",
		{
			d: "M26 26c.3 1.8 1.2 2.7 3 3-1.8.3-2.7 1.2-3 3-.3-1.8-1.2-2.7-3-3 1.8-.3 2.7-1.2 3-3z",
		},
	],
];

/** Original line coin with the same staggered sparkle overlay as React. */
export function createLensCoin(size: number): HTMLSpanElement {
	const coin = document.createElement("span");
	coin.className = "lens-coin-static";
	coin.dataset.mono = "true";
	coin.setAttribute("aria-hidden", "true");
	coin.style.width = `${size}px`;
	coin.style.height = `${size}px`;
	const artwork = document.createElement("span");
	artwork.className = "lens-coin-artwork";
	artwork.append(
		createElement(LENS_COIN_MONO, {
			width: String(size),
			height: String(size),
			"aria-hidden": "true",
		}),
	);
	const sparkles = createElement(LENS_COIN_SPARKLES, {
		class: "lens-coin-sparkles",
		viewBox: "0 0 32 32",
		fill: "currentColor",
		stroke: "none",
		"aria-hidden": "true",
		focusable: "false",
	});
	coin.append(artwork, sparkles);
	return coin;
}

/** Lens amounts use grouping and Latin digits in both languages, like the rest of the UI. */
export function formatLenses(lenses: number, locale: string): string {
	return new Intl.NumberFormat(
		locale.toLowerCase().startsWith("ar") ? "ar-u-nu-latn" : "en",
	).format(lenses);
}
