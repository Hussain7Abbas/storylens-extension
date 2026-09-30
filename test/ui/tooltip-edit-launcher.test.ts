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
import type { EnrichedKeyword, RawKeyword } from "../../src/types/content-data";
import { makeUser } from "../helpers/engine";
import { fakeBrowser } from "../helpers/fake-browser";
import { alias, baseVersion, keyword, version } from "../helpers/keywords";

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
	destroyKeywordTooltipPortal,
	registerKeywordTooltipAnchor,
	setTooltipUser,
} = await import("../../src/utils/keyword-tooltip");
const { enrichKeywords } = await import(
	"../../src/utils/resolve-keyword-version"
);

const POPUP = "chrome-extension://storylens-test/popup.html";
const owner = makeUser("owner");
const raw = keyword({
	createdById: owner.id,
	aliases: [alias({ id: "alias-1", createdById: owner.id })],
	versions: [
		baseVersion({ endingChapter: 9, createdById: owner.id }),
		version({ id: "version-2", startingChapter: 10, createdById: owner.id }),
	],
});

function shadow(): ShadowRoot {
	const root = document.getElementById("storylens-page-launcher")?.shadowRoot;
	if (!root) throw new Error("launcher is not mounted");
	return root;
}

/** Parameters of the popup the launcher has loaded, or undefined without one. */
function popupParams(): Record<string, string> | undefined {
	const frame = shadow().querySelector("iframe");
	if (!frame) return undefined;
	const [page, query = ""] = frame.src.split("?");
	expect(page).toBe(POPUP);
	return Object.fromEntries(new URLSearchParams(query));
}

/** Hovers the keyword's highlighted word and returns its tooltip. */
function hover(data: RawKeyword = raw): HTMLElement {
	const enriched = enrichKeywords([data], 5, "en").find(
		(item) => item.id === data.id,
	) as EnrichedKeyword;
	const anchor = document.createElement("span");
	document.body.append(anchor);
	registerKeywordTooltipAnchor(anchor, enriched, data, null, 5, "en");
	anchor.dispatchEvent(new MouseEvent("mouseenter"));
	const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
	if (!tooltip) throw new Error("tooltip did not open");
	return tooltip;
}

/** Clicks an Edit button the way a reader does: the press reaches the page first. */
function clickEdit(tooltip: HTMLElement, kind: string, index = 0): void {
	const button = tooltip.querySelectorAll<HTMLButtonElement>(
		`[data-edit-kind="${kind}"]`,
	)[index];
	if (!button) throw new Error(`no Edit button for ${kind}`);
	button.dispatchEvent(
		new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
	);
	button.click();
}

type HappyWindow = Window & {
	happyDOM: { settings: { disableIframePageLoading: boolean } };
};
const { settings } = (window as unknown as HappyWindow).happyDOM;
const iframeLoading = settings.disableIframePageLoading;
const loggedErrors = console.error;

beforeEach(() => {
	// happy-dom cannot fetch extension pages; it reports each frame it leaves empty.
	settings.disableIframePageLoading = true;
	console.error = () => {};
	setTooltipUser(owner);
	setPagePopupLauncher(true, "en");
});

afterEach(() => {
	destroyKeywordTooltipPortal();
	setPagePopupLauncher(false, "en");
	setTooltipUser(null);
	document.body.replaceChildren();
	settings.disableIframePageLoading = iframeLoading;
	console.error = loggedErrors;
});

afterAll(async () => {
	if (registeredHere) await GlobalRegistrator.unregister();
});

// Each test starts without a loaded popup. What a popup that is already loaded
// does with a new form request is the launcher's own concern and is covered by
// page-popup-launcher.test.ts; Edit enters the launcher through the same `open`.
describe("tooltip Edit through the launcher", () => {
	it("opens the launcher popup on the character's form", () => {
		expect(popupParams()).toBeUndefined();

		clickEdit(hover(), "keyword");

		expect(shadow().querySelector<HTMLElement>("#panel")?.hidden).toBe(false);
		expect(popupParams()).toEqual({
			edit: "keyword",
			id: "keyword-1",
			parentId: "keyword-1",
			novelId: "novel-1",
		});
		expect(document.querySelector('[role="tooltip"]')).toBeNull();
	});

	it("names an alias and its parent keyword", () => {
		clickEdit(hover(), "alias");
		expect(popupParams()).toEqual({
			edit: "alias",
			id: "alias-1",
			parentId: "keyword-1",
			novelId: "novel-1",
		});
	});

	it("names the clicked version and its parent keyword", () => {
		clickEdit(hover(), "version", 1);
		expect(popupParams()).toEqual({
			edit: "version",
			id: "version-2",
			parentId: "keyword-1",
			novelId: "novel-1",
		});
	});

	it("offers Edit only while the launcher is shown", () => {
		expect(hover().querySelector(".storylens-edit-btn")).not.toBeNull();

		setPagePopupLauncher(false, "en");
		expect(hover().querySelector(".storylens-edit-btn")).toBeNull();

		setPagePopupLauncher(true, "en");
		expect(hover().querySelector(".storylens-edit-btn")).not.toBeNull();
	});
});
