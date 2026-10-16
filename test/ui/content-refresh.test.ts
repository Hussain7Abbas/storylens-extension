/// <reference types="bun" />

import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SHOW_CATEGORY_EFFECTS_KEY } from "../../src/lib/keyword-effects";
import { TOOLTIP_TRIGGER_KEY } from "../../src/lib/tooltip-trigger";
import type { NovelContentData } from "../../src/types/content-data";
import { fakeBrowser, resetFakeBrowser } from "../helpers/fake-browser";
import { keyword } from "../helpers/keywords";

const registeredHere = !GlobalRegistrator.isRegistered;
if (registeredHere)
	GlobalRegistrator.register({
		url: "https://novels.example.invalid/novel/test/chapter/5",
	});
Object.assign(globalThis, {
	browser: fakeBrowser,
	chrome: { runtime: { id: fakeBrowser.runtime.id } },
});
const { refreshPageContent, runContentScript } = await import(
	"../../src/entrypoints/content/main"
);
const { setPagePopupLauncher } = await import(
	"../../src/entrypoints/content/page-popup-launcher"
);
const { applyContentProcessing, removeExtensionMarkup } = await import(
	"../../src/utils/content-processor"
);
const { applyKeywordEffect, setCategoryEffectsVisible } = await import(
	"../../src/utils/keyword-effects"
);

const data: NovelContentData = {
	novel: {
		id: "novel-1",
		nameEn: "Novel",
		nameAr: "رواية",
		descriptionEn: null,
		descriptionAr: null,
		context: null,
		slugs: [],
		imageId: null,
		createdById: null,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	},
	language: "ar",
	chapterNumber: 5,
	keywords: [keyword({ nameAr: "أمل" })],
	replacements: [],
	biases: [],
};
type Reply = { res: NovelContentData | undefined };
let requests: ReturnType<typeof Promise.withResolvers<Reply>>[];
let initial: boolean;
let root: HTMLElement;
let started = false;
const runtime = fakeBrowser.runtime as unknown as {
	sendMessage: (message: unknown) => Promise<unknown>;
};
const originalSend = runtime.sendMessage;

beforeEach(async () => {
	resetFakeBrowser();
	window.history.replaceState(null, "", "/novel/test/chapter/5");
	document.body.replaceChildren();
	root = document.createElement("article");
	root.textContent = `أمل Keyword ${"Chapter text. ".repeat(20)}`;
	document.body.append(root);
	requests = [];
	initial = true;
	runtime.sendMessage = async (message: unknown) => {
		const { type } = message as { type: string };
		if (type === "getWebsiteSelector")
			return {
				res: {
					website: window.location.hostname,
					novel: { url: { regex: "/novel/([^/]+)" } },
					chapter: { url: { regex: "/chapter/(\\d+)" } },
				},
			};
		if (type === "getNovelContentData") {
			if (initial) {
				initial = false;
				return { res: data };
			}
			const reply = Promise.withResolvers<Reply>();
			requests.push(reply);
			return reply.promise;
		}
		return { res: undefined };
	};
	if (!started) {
		await fakeBrowser.storage.local.set({
			[TOOLTIP_TRIGGER_KEY]: "hover",
			[SHOW_CATEGORY_EFFECTS_KEY]: true,
		});
		await runContentScript({ addEventListener() {} } as unknown as Parameters<
			typeof runContentScript
		>[0]);
		// Initial highlighting is deferred by runContentScript.
		await new Promise((resolve) => setTimeout(resolve, 0));
		started = true;
	} else {
		initial = false;
		applyContentProcessing(root, data, "test:5");
	}
	expect(root.querySelector(".storylens-keyword")?.textContent).toBe("أمل");
});
afterEach(() => {
	setCategoryEffectsVisible(false);
	removeExtensionMarkup();
	setPagePopupLauncher(false, "en");
	runtime.sendMessage = originalSend;
	document.body.replaceChildren();
});
afterAll(async () => {
	if (registeredHere) await GlobalRegistrator.unregister();
});

describe("page highlight refresh", () => {
	it("loads the saved tooltip trigger and applies storage changes to existing highlights", async () => {
		const anchor = root.querySelector<HTMLElement>(".storylens-keyword");
		if (!anchor) throw new Error("keyword missing");
		const visible = () => document.querySelector('[role="tooltip"]');
		anchor.dispatchEvent(new MouseEvent("mouseenter"));
		expect(visible()).not.toBeNull();
		await fakeBrowser.storage.local.set({ [TOOLTIP_TRIGGER_KEY]: "click" });
		expect(visible()).toBeNull();
		expect(root.querySelector(".storylens-keyword")).toBe(anchor);
		anchor.dispatchEvent(new MouseEvent("mouseenter"));
		expect(visible()).toBeNull();
		anchor.click();
		expect(visible()).not.toBeNull();
		await fakeBrowser.storage.local.set({ [TOOLTIP_TRIGGER_KEY]: "hover" });
		expect(visible()).toBeNull();
		await fakeBrowser.storage.local.remove(TOOLTIP_TRIGGER_KEY);
		anchor.dispatchEvent(new MouseEvent("mouseenter"));
		expect(visible()).toBeNull();
		anchor.click();
		expect(visible()).not.toBeNull();
		// The saved category-effects preference was loaded at startup too.
		applyKeywordEffect(anchor, "HEAT");
		expect(anchor.dataset.storylensEffect).toBe("HEAT");
		expect(anchor.querySelectorAll(".storylens-effect-smoke")).toHaveLength(3);
		await fakeBrowser.storage.local.set({ [SHOW_CATEGORY_EFFECTS_KEY]: false });
		expect(anchor.dataset.storylensEffect).toBeUndefined();
		expect(
			document.getElementById("storylens-keyword-effect-filters"),
		).toBeNull();
		await fakeBrowser.storage.local.set({ [SHOW_CATEGORY_EFFECTS_KEY]: true });
		expect(anchor.dataset.storylensEffect).toBe("HEAT");
		expect(root.querySelector(".storylens-keyword")).toBe(anchor);
		expect(anchor.textContent).toBe("أمل");
		await fakeBrowser.storage.local.remove(SHOW_CATEGORY_EFFECTS_KEY);
		expect(anchor.dataset.storylensEffect).toBeUndefined();
	});

	it("keeps existing keywords visible while replacement data is pending", async () => {
		const pending = refreshPageContent();
		await new Promise((resolve) => setTimeout(resolve, 0));
		const retained = root.querySelector(".storylens-keyword")?.textContent;
		requests[0].resolve({ res: data });
		await pending;
		expect(retained).toBe("أمل");
		expect(root.querySelectorAll(".storylens-keyword")).toHaveLength(1);
	});
	it("preserves highlights when the background returns no data", async () => {
		const pending = refreshPageContent();
		await new Promise((resolve) => setTimeout(resolve, 0));
		requests[0].resolve({ res: undefined });
		await pending;
		expect(root.querySelector(".storylens-keyword")?.textContent).toBe("أمل");
	});
	it("preserves highlights when the background request fails", async () => {
		const pending = refreshPageContent();
		await new Promise((resolve) => setTimeout(resolve, 0));
		requests[0].reject(new Error("worker disconnected"));
		await pending;
		expect(root.querySelector(".storylens-keyword")?.textContent).toBe("أمل");
	});
	it("ignores an older English refresh that finishes after the Arabic refresh", async () => {
		const older = refreshPageContent();
		const newer = refreshPageContent();
		await new Promise((resolve) => setTimeout(resolve, 0));
		requests[1].resolve({ res: data });
		await newer;
		requests[0].resolve({ res: { ...data, language: "en" } });
		await older;
		expect(root.querySelectorAll(".storylens-keyword")).toHaveLength(1);
		expect(root.querySelector(".storylens-keyword")?.textContent).toBe("أمل");
	});
	it("ignores a response belonging to the page before navigation", async () => {
		const pending = refreshPageContent();
		await new Promise((resolve) => setTimeout(resolve, 0));
		window.history.replaceState(null, "", "/novel/other/chapter/6");
		requests[0].resolve({ res: { ...data, keywords: [] } });
		await pending;
		expect(root.querySelector(".storylens-keyword")?.textContent).toBe("أمل");
	});
	it("removes old highlights when a successful refresh has no keywords", async () => {
		const pending = refreshPageContent();
		await new Promise((resolve) => setTimeout(resolve, 0));
		requests[0].resolve({ res: { ...data, keywords: [] } });
		await pending;
		expect(root.querySelector(".storylens-keyword")).toBeNull();
	});
});
