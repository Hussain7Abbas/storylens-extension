import {
	hasWordVfxColor,
	parseKeywordEffect,
	parseShowWordVfx,
	parseWordVfxColor,
} from "@/lib/keyword-effects";

const FILTERS_ID = "storylens-keyword-effect-filters";
const HEAT_FILTER_ID = "storylens-keyword-heat-filter";
const GLITCH_FILTER_ID = "storylens-keyword-glitch-filter";
const SVG_NS = "http://www.w3.org/2000/svg";
const SCROLL_IDLE_MS = 150;
let effectsVisible = false;
let observer: IntersectionObserver | undefined;
let motionQuery: MediaQueryList | undefined;
let tracking = false;
let scrolling = false;
let scrollIdle: ReturnType<typeof setTimeout> | undefined;
let filtersPlaying: boolean | undefined;
const trackedAnchors = new Set<HTMLElement>();
const visibleAnchors = new Set<HTMLElement>();

/** SMIL filters otherwise keep repainting even when their CSS animation is paused. */
function syncFilterAnimation(): void {
	const svg = document.getElementById(FILTERS_ID) as SVGSVGElement | null;
	if (!svg) return;
	const playing =
		!scrolling &&
		!document.hidden &&
		!motionQuery?.matches &&
		[...visibleAnchors].some(
			(anchor) =>
				anchor.dataset.storylensEffect === "HEAT" ||
				anchor.dataset.storylensEffect === "GLITCHING",
		);
	if (filtersPlaying === playing) return;
	filtersPlaying = playing;
	if (playing) svg.unpauseAnimations?.();
	else svg.pauseAnimations?.();
}

function syncMotion(): void {
	document.documentElement.toggleAttribute(
		"data-storylens-vfx-paused",
		scrolling || document.hidden || motionQuery?.matches === true,
	);
	syncFilterAnimation();
}

function onScroll(): void {
	if (!scrolling) {
		scrolling = true;
		syncMotion();
	}
	clearTimeout(scrollIdle);
	scrollIdle = setTimeout(() => {
		scrolling = false;
		syncMotion();
	}, SCROLL_IDLE_MS);
}

/** One observer for the chapter; no layout reads or word scans on scroll. */
function trackAnchor(anchor: HTMLElement): void {
	if (!tracking) {
		tracking = true;
		motionQuery = window.matchMedia(
			"(prefers-reduced-motion: reduce), (forced-colors: active)",
		);
		motionQuery.addEventListener("change", syncMotion);
		document.addEventListener("visibilitychange", syncMotion);
		window.addEventListener("scroll", onScroll, {
			capture: true,
			passive: true,
		});
		if (typeof IntersectionObserver !== "undefined") {
			observer = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						const target = entry.target as HTMLElement;
						if (!trackedAnchors.has(target)) continue;
						if (entry.isIntersecting) {
							visibleAnchors.add(target);
							target.dataset.storylensEffectActive = "";
						} else {
							visibleAnchors.delete(target);
							delete target.dataset.storylensEffectActive;
						}
					}
					syncFilterAnimation();
				},
				{ rootMargin: "48px" },
			);
		}
		syncMotion();
	}
	trackedAnchors.add(anchor);
	if (observer) observer.observe(anchor);
	else {
		visibleAnchors.add(anchor);
		anchor.dataset.storylensEffectActive = "";
	}
	syncFilterAnimation();
}

function untrackAnchor(anchor: HTMLElement): void {
	observer?.unobserve(anchor);
	trackedAnchors.delete(anchor);
	visibleAnchors.delete(anchor);
	delete anchor.dataset.storylensEffectActive;
	syncFilterAnimation();
}

function svgNode(name: string, attributes: Record<string, string>): SVGElement {
	const node = document.createElementNS(SVG_NS, name);
	for (const [key, value] of Object.entries(attributes))
		node.setAttribute(key, value);
	return node;
}

/** Shared maps distort whole glyphs without splitting connected Arabic lettering. */
function ensureFilter(kind: "HEAT" | "GLITCHING"): void {
	const id = kind === "HEAT" ? HEAT_FILTER_ID : GLITCH_FILTER_ID;
	if (document.getElementById(id)) return;
	let svg: Element | null = document.getElementById(FILTERS_ID);
	if (!svg) {
		const root = svgNode("svg", {
			id: FILTERS_ID,
			width: "0",
			height: "0",
			"aria-hidden": "true",
			"data-storylens-skip": "",
		});
		root.style.cssText = "position:fixed;pointer-events:none;overflow:hidden";
		document.documentElement.append(root);
		filtersPlaying = undefined;
		svg = root;
	}
	const filter = svgNode("filter", {
		id,
		x: "-20%",
		y: kind === "HEAT" ? "-160%" : "-45%",
		width: "140%",
		height: kind === "HEAT" ? "300%" : "180%",
		"color-interpolation-filters": "sRGB",
	});
	const heat = kind === "HEAT";
	const turbulence = svgNode("feTurbulence", {
		type: heat ? "fractalNoise" : "turbulence",
		baseFrequency: heat ? "0.025 0.08" : "0.08 0.3",
		numOctaves: "1",
		seed: heat ? "7" : "13",
		result: "noise",
	});
	if (heat) {
		turbulence.append(
			svgNode("animate", {
				attributeName: "baseFrequency",
				values: "0.025 0.08;0.045 0.13;0.025 0.08",
				dur: "1.15s",
				repeatCount: "indefinite",
			}),
		);
	}
	filter.append(turbulence);
	if (!heat) {
		// Quantized displacement creates hard pixel tears instead of a bold pulse.
		const blocks = svgNode("feComponentTransfer", {
			in: "noise",
			result: "blocks",
		});
		for (const channel of ["feFuncR", "feFuncG"])
			blocks.append(
				svgNode(channel, {
					type: "discrete",
					tableValues: "0 0.25 0.5 0.75 1",
				}),
			);
		filter.append(blocks);
	}
	const displacement = svgNode("feDisplacementMap", {
		in: "SourceGraphic",
		in2: heat ? "noise" : "blocks",
		scale: heat ? "3" : "0",
		xChannelSelector: "R",
		yChannelSelector: "G",
	});
	if (!heat) {
		displacement.append(
			svgNode("animate", {
				attributeName: "scale",
				values: "0;6;0;0;4;0;0;0",
				keyTimes: "0;0.08;0.16;0.48;0.56;0.64;0.82;1",
				calcMode: "discrete",
				dur: "1.6s",
				repeatCount: "indefinite",
			}),
		);
	}
	filter.append(displacement);
	svg.append(filter);
	syncFilterAnimation();
}

function decoration(anchor: HTMLElement, className: string): HTMLSpanElement {
	const element = document.createElement("span");
	element.className = className;
	element.setAttribute("aria-hidden", "true");
	element.setAttribute("data-storylens-effect-decoration", "");
	anchor.append(element);
	return element;
}

/** Empty decorations preserve copying, matching, selection, tooltips and Arabic shaping. */
export function applyKeywordEffect(
	anchor: HTMLElement,
	value: unknown,
	colorValue?: unknown,
): void {
	untrackAnchor(anchor);
	const color = hasWordVfxColor(value) ? parseWordVfxColor(colorValue) : null;
	if (color) {
		anchor.dataset.storylensWordVfxColor = color;
		anchor.style.setProperty("--sl-word-vfx-color", color);
	} else {
		delete anchor.dataset.storylensWordVfxColor;
		anchor.style.removeProperty("--sl-word-vfx-color");
	}
	for (const child of anchor.querySelectorAll(
		":scope > [data-storylens-effect-decoration]",
	))
		child.remove();
	delete anchor.dataset.storylensEffect;
	const effect = parseKeywordEffect(value);
	if (effect === "NONE") {
		delete anchor.dataset.storylensWordVfx;
		return;
	}
	// Remember the word effect independently of whether this reader wants motion.
	anchor.dataset.storylensWordVfx = effect;
	if (!effectsVisible) return;
	anchor.dataset.storylensEffect = effect;
	if (effect === "HEAT" || effect === "GLITCHING") ensureFilter(effect);
	if (effect === "SPARKLES") {
		const heights = [35, 8, 65, 24, 58, 5, 44, 17];
		for (let index = 0; index < heights.length; index++) {
			const particle = decoration(anchor, "storylens-effect-particle");
			particle.style.setProperty("--sl-effect-x", `${4 + index * 13}%`);
			particle.style.setProperty("--sl-effect-y", `${heights[index]}%`);
			particle.style.setProperty("--sl-effect-delay", `${index * -0.14}s`);
			particle.style.setProperty("--sl-effect-size", `${3 + (index % 3)}px`);
		}
	} else if (effect === "HEAT") {
		for (let index = 0; index < 3; index++) {
			const smoke = decoration(anchor, "storylens-effect-smoke");
			smoke.style.setProperty("--sl-effect-x", `${18 + index * 32}%`);
			smoke.style.setProperty("--sl-effect-delay", `${index * -0.42}s`);
		}
	} else if (effect === "GLITCHING") {
		decoration(anchor, "storylens-effect-pixels");
	}
	trackAnchor(anchor);
}

/** Toggle decorations on existing anchors; never remove or rebuild their text. */
export function setWordVfxVisible(value: unknown): void {
	effectsVisible = parseShowWordVfx(value);
	for (const anchor of document.querySelectorAll<HTMLElement>(
		".storylens-keyword[data-storylens-word-vfx], .storylens-keyword[data-storylens-effect]",
	))
		applyKeywordEffect(
			anchor,
			anchor.dataset.storylensWordVfx ?? anchor.dataset.storylensEffect,
			anchor.dataset.storylensWordVfxColor,
		);
	if (!effectsVisible) clearKeywordEffects();
}

export function clearKeywordEffects(): void {
	observer?.disconnect();
	observer = undefined;
	for (const anchor of trackedAnchors)
		delete anchor.dataset.storylensEffectActive;
	trackedAnchors.clear();
	visibleAnchors.clear();
	clearTimeout(scrollIdle);
	scrollIdle = undefined;
	scrolling = false;
	motionQuery?.removeEventListener("change", syncMotion);
	motionQuery = undefined;
	document.removeEventListener("visibilitychange", syncMotion);
	window.removeEventListener("scroll", onScroll, true);
	document.documentElement.removeAttribute("data-storylens-vfx-paused");
	tracking = false;
	filtersPlaying = undefined;
	document.getElementById(FILTERS_ID)?.remove();
}
