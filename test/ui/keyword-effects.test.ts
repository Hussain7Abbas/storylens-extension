/// <reference types="bun" />
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const registeredHere = !GlobalRegistrator.isRegistered;
if (registeredHere)
	GlobalRegistrator.register({
		url: "https://novels.example.invalid/chapter/1",
	});

const { applyKeywordEffect, setWordVfxVisible } = await import(
	"../../src/utils/keyword-effects"
);
const originalObserver = globalThis.IntersectionObserver;
const observers: EffectObserver[] = [];
class EffectObserver {
	disconnected = false;
	anchors = new Set<Element>();
	constructor(private callback: IntersectionObserverCallback) {
		observers.push(this);
	}
	observe(anchor: Element) {
		this.anchors.add(anchor);
	}
	unobserve(anchor: Element) {
		this.anchors.delete(anchor);
	}
	disconnect() {
		this.disconnected = true;
		this.anchors.clear();
	}
	intersect(anchor: Element, visible: boolean) {
		this.callback(
			[
				{
					target: anchor,
					isIntersecting: visible,
				} as IntersectionObserverEntry,
			],
			this as unknown as IntersectionObserver,
		);
	}
}
function word(effect: string) {
	const anchor = document.createElement("span");
	anchor.className = "storylens-keyword";
	anchor.append(document.createTextNode("سيف الدين"));
	document.body.append(anchor);
	applyKeywordEffect(anchor, effect);
	return anchor;
}

beforeEach(() => {
	setWordVfxVisible(false);
	document.body.replaceChildren();
	observers.length = 0;
	globalThis.IntersectionObserver =
		EffectObserver as unknown as typeof IntersectionObserver;
	setWordVfxVisible(true);
});
afterEach(() => {
	setWordVfxVisible(false);
	document.body.replaceChildren();
	globalThis.IntersectionObserver = originalObserver;
});
afterAll(() => {
	if (registeredHere) GlobalRegistrator.unregister();
});

test("one observer activates nearby words without rebuilding their text", () => {
	const first = word("HEAT"),
		second = word("SPARKLES");
	const text = first.firstChild;
	expect(observers).toHaveLength(1);
	expect(observers[0]?.anchors.size).toBe(2);
	expect(first.hasAttribute("data-storylens-effect-active")).toBe(false);
	observers[0]?.intersect(first, true);
	expect(first.hasAttribute("data-storylens-effect-active")).toBe(true);
	expect(second.hasAttribute("data-storylens-effect-active")).toBe(false);
	observers[0]?.intersect(first, false);
	expect(first.hasAttribute("data-storylens-effect-active")).toBe(false);
	expect(first.firstChild).toBe(text);
	expect(first.textContent).toBe("سيف الدين");
});

test("scrolling nested content pauses SVG filters and resumes after scrolling stops", async () => {
	const anchor = word("HEAT");
	const svg = document.getElementById("storylens-keyword-effect-filters");
	if (!svg) throw new Error("Filter missing");
	let pauses = 0,
		resumes = 0;
	Object.assign(svg, {
		pauseAnimations: () => pauses++,
		unpauseAnimations: () => resumes++,
	});
	observers[0]?.intersect(anchor, true);
	expect(resumes).toBe(1);
	const container = document.createElement("div");
	document.body.append(container);
	container.dispatchEvent(new Event("scroll"));
	expect(
		document.documentElement.hasAttribute("data-storylens-vfx-paused"),
	).toBe(true);
	expect(pauses).toBe(1);
	await new Promise((resolve) => setTimeout(resolve, 180));
	expect(
		document.documentElement.hasAttribute("data-storylens-vfx-paused"),
	).toBe(false);
	expect(resumes).toBe(2);
	observers[0]?.intersect(anchor, false);
	expect(pauses).toBe(2);
});

test("disabling VFX cleans up observers and pending scroll resumption", async () => {
	const anchor = word("GLITCHING");
	observers[0]?.intersect(anchor, true);
	window.dispatchEvent(new Event("scroll"));
	setWordVfxVisible(false);
	expect(observers[0]?.disconnected).toBe(true);
	expect(
		document.getElementById("storylens-keyword-effect-filters"),
	).toBeNull();
	expect(anchor.hasAttribute("data-storylens-effect-active")).toBe(false);
	observers[0]?.intersect(anchor, true);
	window.dispatchEvent(new Event("scroll"));
	await new Promise((resolve) => setTimeout(resolve, 180));
	expect(anchor.hasAttribute("data-storylens-effect-active")).toBe(false);
	expect(
		document.documentElement.hasAttribute("data-storylens-vfx-paused"),
	).toBe(false);
});
