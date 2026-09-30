/// <reference types="bun" />
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Another UI test file may have registered (and later unregisters) the DOM.
const registeredHere = !GlobalRegistrator.isRegistered;
if (registeredHere)
	GlobalRegistrator.register({ url: "https://novels.example.invalid/ch/5" });

import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { fakeBrowser } from "../helpers/fake-browser";

// webextension-polyfill (used by the messaging library) refuses to load in a page
// without an extension API; it reuses a global `browser` that has a runtime ID.
Object.assign(globalThis, {
	browser: fakeBrowser,
	chrome: { runtime: { id: fakeBrowser.runtime.id } },
});

const { setPagePopupLauncher } = await import(
	"../../src/entrypoints/content/page-popup-launcher"
);
const {
	NIGHT_LIGHT_DEFAULT_LEVEL,
	NIGHT_LIGHT_ENABLED_KEY,
	NIGHT_LIGHT_LEVEL_KEY,
	NIGHT_LIGHT_MAX_LEVEL,
	NIGHT_LIGHT_MIN_LEVEL,
	parseNightLightLevel,
} = await import("../../src/lib/night-light");

const storage = fakeBrowser.storage.local;

function action(): HTMLButtonElement {
	const found = document
		.getElementById("storylens-page-launcher")
		?.shadowRoot?.querySelector<HTMLButtonElement>(
			'[data-action="night-light"]',
		);
	if (!found) throw new Error("the night light action is missing");
	return found;
}

const layer = () => document.getElementById("storylens-night-light");

/** The layer's strength, or undefined while the night light is off. */
const strength = () => layer()?.style.opacity;

/** Lets the fake storage deliver its reads, writes and change events. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

/** Shows the launcher and waits until it loaded its stored state. */
async function mount(locale = "en"): Promise<void> {
	setPagePopupLauncher(true, locale);
	await settle();
}

beforeEach(async () => {
	await storage.remove([NIGHT_LIGHT_ENABLED_KEY, NIGHT_LIGHT_LEVEL_KEY]);
});

afterEach(async () => {
	setPagePopupLauncher(false, "en");
	// Launcher tests in other files share this storage.
	await storage.remove([NIGHT_LIGHT_ENABLED_KEY, NIGHT_LIGHT_LEVEL_KEY]);
	document.body.replaceChildren();
});

afterAll(async () => {
	if (registeredHere) await GlobalRegistrator.unregister();
});

describe("night light level", () => {
	it("keeps a stored level inside the supported range", () => {
		expect(parseNightLightLevel(45)).toBe(45);
		expect(parseNightLightLevel(NIGHT_LIGHT_MIN_LEVEL)).toBe(
			NIGHT_LIGHT_MIN_LEVEL,
		);
		expect(parseNightLightLevel(NIGHT_LIGHT_MAX_LEVEL)).toBe(
			NIGHT_LIGHT_MAX_LEVEL,
		);
		expect(parseNightLightLevel(0)).toBe(NIGHT_LIGHT_MIN_LEVEL);
		expect(parseNightLightLevel(-20)).toBe(NIGHT_LIGHT_MIN_LEVEL);
		expect(parseNightLightLevel(500)).toBe(NIGHT_LIGHT_MAX_LEVEL);
	});

	it("falls back to the default for anything that is not a level", () => {
		for (const value of [undefined, null, "45", Number.NaN, Infinity, {}])
			expect(parseNightLightLevel(value)).toBe(NIGHT_LIGHT_DEFAULT_LEVEL);
	});

	it("starts the popup atom at the saved level before mirroring it", async () => {
		window.localStorage.setItem(NIGHT_LIGHT_LEVEL_KEY, "60");
		try {
			// A fresh popup evaluates its store module after localStorage is available.
			const appearancePath =
				"../../src/store/appearance.ts?night-light-initial-level";
			const { nightLightLevelAtom } = (await import(
				appearancePath
			)) as typeof import("../../src/store/appearance");
			const { createStore } = await import("jotai");
			expect(createStore().get(nightLightLevelAtom)).toBe(60);
		} finally {
			window.localStorage.removeItem(NIGHT_LIGHT_LEVEL_KEY);
		}
	});
});

describe("launcher night light action", () => {
	it("is off by default and offers to turn the night light on", async () => {
		await mount();
		expect(layer()).toBeNull();
		expect(action().getAttribute("aria-label")).toBe("Turn on night light");
		expect(action().title).toBe("Turn on night light");
		expect(action().getAttribute("aria-disabled")).toBe("false");
		expect(action().querySelector("svg")).not.toBeNull();
	});

	it("lays a yellow layer over the whole page and remembers it", async () => {
		await mount();
		const offIcon = action().innerHTML;

		action().click();

		const overlay = layer();
		if (!overlay) throw new Error("the night light layer is missing");
		// Outside <body> and after it, so it also covers the launcher and its popup.
		expect(overlay.parentElement).toBe(document.documentElement);
		expect(document.documentElement.lastElementChild).toBe(overlay);
		expect(overlay.style.position).toBe("fixed");
		expect(overlay.style.mixBlendMode).toBe("multiply");
		// The page under the layer stays clickable and is not read as page text.
		expect(overlay.style.pointerEvents).toBe("none");
		expect(overlay.hasAttribute("data-storylens-skip")).toBe(true);
		expect(overlay.getAttribute("aria-hidden")).toBe("true");
		expect(strength()).toBe(String(NIGHT_LIGHT_DEFAULT_LEVEL / 100));
		expect(action().getAttribute("aria-label")).toBe("Turn off night light");
		expect(action().title).toBe("Turn off night light");
		expect(action().innerHTML).not.toBe(offIcon);
		expect(action().querySelectorAll("svg")).toHaveLength(1);

		await settle();
		expect(storage.peek(NIGHT_LIGHT_ENABLED_KEY)).toBe(true);
	});

	it("removes the layer when it is turned off again", async () => {
		await mount();
		const offIcon = action().innerHTML;
		action().click();
		await settle();

		action().click();

		expect(layer()).toBeNull();
		expect(action().getAttribute("aria-label")).toBe("Turn on night light");
		expect(action().innerHTML).toBe(offIcon);
		await settle();
		expect(storage.peek(NIGHT_LIGHT_ENABLED_KEY)).toBe(false);
	});

	it("restores the saved state and level on the next page", async () => {
		await storage.set({
			[NIGHT_LIGHT_ENABLED_KEY]: true,
			[NIGHT_LIGHT_LEVEL_KEY]: 55,
		});

		await mount();

		expect(strength()).toBe("0.55");
		expect(action().getAttribute("aria-label")).toBe("Turn off night light");
		expect(document.querySelectorAll("#storylens-night-light")).toHaveLength(1);
	});

	it("follows the level set in the Appearance settings at once", async () => {
		await mount();
		action().click();
		await settle();

		await storage.set({ [NIGHT_LIGHT_LEVEL_KEY]: 60 });
		expect(strength()).toBe("0.6");
		expect(document.querySelectorAll("#storylens-night-light")).toHaveLength(1);

		// A value typed halfway, or one that is not a level, never leaves the range.
		await storage.set({ [NIGHT_LIGHT_LEVEL_KEY]: 500 });
		expect(strength()).toBe(String(NIGHT_LIGHT_MAX_LEVEL / 100));
		await storage.set({ [NIGHT_LIGHT_LEVEL_KEY]: 4 });
		expect(strength()).toBe(String(NIGHT_LIGHT_MIN_LEVEL / 100));
		await storage.set({ [NIGHT_LIGHT_LEVEL_KEY]: "bright" });
		expect(strength()).toBe(String(NIGHT_LIGHT_DEFAULT_LEVEL / 100));
	});

	it("keeps a level changed while off for the next time it is on", async () => {
		await mount();

		await storage.set({ [NIGHT_LIGHT_LEVEL_KEY]: 70 });
		expect(layer()).toBeNull();

		action().click();
		expect(strength()).toBe("0.7");
	});

	it("follows a toggle made in another tab", async () => {
		await mount();

		await storage.set({ [NIGHT_LIGHT_ENABLED_KEY]: true });
		expect(strength()).toBe(String(NIGHT_LIGHT_DEFAULT_LEVEL / 100));
		expect(action().getAttribute("aria-label")).toBe("Turn off night light");

		await storage.set({ [NIGHT_LIGHT_ENABLED_KEY]: false });
		expect(layer()).toBeNull();
		expect(action().getAttribute("aria-label")).toBe("Turn on night light");
	});

	it("keeps a toggle made before the saved state loaded", async () => {
		setPagePopupLauncher(true, "en");
		action().click();
		expect(layer()).not.toBeNull();

		await settle();

		expect(layer()).not.toBeNull();
		expect(storage.peek(NIGHT_LIGHT_ENABLED_KEY)).toBe(true);
	});

	it("keeps storage changes that arrive before the initial read", async () => {
		const originalGet = storage.get;
		let finishRead: ((value: Record<string, unknown>) => void) | undefined;
		const initialRead = new Promise<Record<string, unknown>>((resolve) => {
			finishRead = resolve;
		});
		storage.get = async (keys) =>
			Array.isArray(keys) && keys.includes(NIGHT_LIGHT_ENABLED_KEY)
				? initialRead
				: originalGet(keys);
		try {
			setPagePopupLauncher(true, "en");
			await storage.set({
				[NIGHT_LIGHT_ENABLED_KEY]: true,
				[NIGHT_LIGHT_LEVEL_KEY]: 70,
			});
			expect(strength()).toBe("0.7");

			finishRead?.({
				[NIGHT_LIGHT_ENABLED_KEY]: false,
				[NIGHT_LIGHT_LEVEL_KEY]: 20,
			});
			await settle();

			expect(strength()).toBe("0.7");
			expect(action().getAttribute("aria-label")).toBe("Turn off night light");
		} finally {
			finishRead?.({});
			storage.get = originalGet;
		}
	});

	it("removes the layer with the launcher and restores it with it", async () => {
		await mount();
		action().click();
		await settle();

		setPagePopupLauncher(false, "en");
		expect(layer()).toBeNull();
		// Hiding the launcher is not turning the night light off.
		expect(storage.peek(NIGHT_LIGHT_ENABLED_KEY)).toBe(true);

		// A removed launcher no longer follows the settings.
		await storage.set({ [NIGHT_LIGHT_LEVEL_KEY]: 40 });
		expect(layer()).toBeNull();

		await mount();
		expect(strength()).toBe("0.4");
	});

	it("names the action in the extension language", async () => {
		await mount("ar");
		expect(action().getAttribute("aria-label")).toBe("شغّل الإضاءة الليلية");
		action().click();
		expect(action().getAttribute("aria-label")).toBe("أوقف الإضاءة الليلية");

		setPagePopupLauncher(true, "en");
		expect(action().getAttribute("aria-label")).toBe("Turn off night light");
	});

	it("leaves the other actions as they were", async () => {
		await mount();
		const names = [
			...(document
				.getElementById("storylens-page-launcher")
				?.shadowRoot?.querySelectorAll<HTMLElement>(".action") ?? []),
		].map((element) => element.dataset.action);
		expect(names).toEqual(["select", "summarize", "extract", "night-light"]);
	});
});
