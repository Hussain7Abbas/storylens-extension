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

const { pagePopupLauncherNavigated, setPagePopupLauncher } = await import(
	"../../src/entrypoints/content/page-popup-launcher"
);
const {
	POPUP_ANSWER_MESSAGE,
	POPUP_READY_MESSAGE,
	POPUP_REQUEST_MESSAGE,
	POPUP_SHOWN_MESSAGE,
	POPUP_STATE_MESSAGE,
} = await import("../../src/lib/launcher-frame/messages");

const POPUP = "chrome-extension://storylens-test/popup.html";
// Bun gives extension URLs an opaque origin; browsers report the extension's own.
const ORIGIN = new URL(POPUP).origin;

type FrameWindow = { posted: { message: unknown; origin: string }[] };
const frameWindows = new WeakMap<HTMLIFrameElement, FrameWindow>();

function root(): ShadowRoot {
	const shadow = document.getElementById("storylens-page-launcher")?.shadowRoot;
	if (!shadow) throw new Error("launcher is not mounted");
	return shadow;
}

function element<T extends HTMLElement>(selector: string): T {
	const found = root().querySelector<T>(selector);
	if (!found) throw new Error(`${selector} is missing`);
	return found;
}

const button = () => element<HTMLButtonElement>("#launcher");
const panel = () => element("#panel");
const status = () => element("#status");
const frames = () => [...root().querySelectorAll("iframe")];

/** The popup frame: the one that is not the selection chooser. */
function popupFrame(): HTMLIFrameElement | undefined {
	return frames().find((frame) => !frame.src.includes("view=selection"));
}

/** happy-dom cannot load extension pages, so each frame gets a stand-in window. */
function frameWindow(frame: HTMLIFrameElement): FrameWindow {
	let stub = frameWindows.get(frame);
	if (!stub) {
		const posted: FrameWindow["posted"] = [];
		stub = { posted };
		frameWindows.set(frame, stub);
		Object.defineProperty(frame, "contentWindow", {
			configurable: true,
			value: Object.assign(stub, {
				postMessage: (message: unknown, origin: string) =>
					posted.push({ message, origin }),
			}),
		});
	}
	return stub;
}

function post(
	frame: HTMLIFrameElement,
	data: unknown,
	overrides: { origin?: string; source?: unknown } = {},
): void {
	window.dispatchEvent(
		new MessageEvent("message", {
			data,
			origin: overrides.origin ?? ORIGIN,
			source: ("source" in overrides
				? overrides.source
				: frameWindow(frame)) as MessageEventSource,
		}),
	);
}

function report(
	frame: HTMLIFrameElement,
	state: { dirty?: boolean; working?: boolean; failed?: boolean },
): void {
	post(frame, { type: POPUP_STATE_MESSAGE, ...state });
}

type Request = { type: string; id: string; query: string; reload: boolean };

/** The requests the launcher sent to `frame`, oldest first. */
function requests(frame: HTMLIFrameElement): Request[] {
	return frameWindow(frame)
		.posted.map((entry) => entry.message as Request)
		.filter((message) => message.type === POPUP_REQUEST_MESSAGE);
}

/** The popup's answer to the launcher's latest request. */
function answer(frame: HTMLIFrameElement, kept: boolean): void {
	const request = requests(frame).at(-1);
	if (!request) throw new Error("the launcher sent no request");
	post(frame, { type: POPUP_ANSWER_MESSAGE, id: request.id, kept });
}

function clickPage(): void {
	document.body.dispatchEvent(
		new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
	);
}

/** Opens the popup from the launcher button; its document loads unless `loaded` is false. */
function openPopup(loaded = true): HTMLIFrameElement {
	button().click();
	const frame = popupFrame();
	if (!frame) throw new Error("popup frame is missing");
	frameWindow(frame);
	if (loaded) post(frame, { type: POPUP_READY_MESSAGE });
	return frame;
}

/** Picks `word` on the page with the launcher's + action and returns the chooser frame. */
async function pick(word: HTMLElement): Promise<HTMLIFrameElement> {
	element<HTMLButtonElement>('[data-action="select"]').click();
	word.dispatchEvent(
		new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
	);
	const range = document.createRange();
	range.selectNodeContents(word);
	window.getSelection()?.addRange(range);
	word.dispatchEvent(
		new PointerEvent("pointerup", { bubbles: true, button: 0 }),
	);
	await new Promise((resolve) => setTimeout(resolve, 5));
	const chooser = frames().find((frame) =>
		frame.src.includes("view=selection"),
	);
	if (!chooser) throw new Error("chooser frame is missing");
	frameWindow(chooser);
	return chooser;
}

/** Picks a word and asks for its keyword form, as the chooser does. */
async function requestForm(text: string): Promise<void> {
	const node = document.createElement("p");
	node.textContent = text;
	document.body.append(node);
	const chooser = await pick(node);
	post(chooser, {
		type: "storylens-selection-create",
		kind: "keyword",
		novelId: "novel-1",
		ai: false,
	});
	expect(chooser.isConnected).toBe(false);
}

const formQuery = (text: string) =>
	`create=keyword&novelId=novel-1&search=${text}`;
const notice = () => element('[role="status"]');

type HappyWindow = Window & {
	happyDOM: { settings: { disableIframePageLoading: boolean } };
};
const { settings } = (window as unknown as HappyWindow).happyDOM;
const iframeLoading = settings.disableIframePageLoading;
const loggedErrors = console.error;
const now = Date.now;

beforeEach(() => {
	// happy-dom cannot fetch extension pages; it reports each frame it leaves empty.
	settings.disableIframePageLoading = true;
	console.error = () => {};
	setPagePopupLauncher(true, "en");
});

afterEach(() => {
	setPagePopupLauncher(false, "en");
	document.body.replaceChildren();
	settings.disableIframePageLoading = iframeLoading;
	console.error = loggedErrors;
	Date.now = now;
});

afterAll(async () => {
	if (registeredHere) await GlobalRegistrator.unregister();
});

describe("launcher popup frame", () => {
	it("keeps the popup loaded while it is closed and shows it again", () => {
		const frame = openPopup();
		expect(frame.src).toBe(POPUP);
		expect(panel().hidden).toBe(false);

		clickPage();
		expect(panel().hidden).toBe(true);
		expect(button().getAttribute("aria-expanded")).toBe("false");
		expect(frame.isConnected).toBe(true);

		button().click();
		expect(panel().hidden).toBe(false);
		expect(popupFrame()).toBe(frame);
		expect(frames()).toHaveLength(1);
		// The kept popup is told it is visible again, so it can refresh stale data.
		expect(frameWindow(frame).posted).toEqual([
			{ message: { type: POPUP_SHOWN_MESSAGE }, origin: ORIGIN },
		]);

		button().click();
		expect(panel().hidden).toBe(true);
		expect(popupFrame()).toBe(frame);
	});

	it("keeps the popup on Escape and removes it with the launcher", () => {
		const frame = openPopup();
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(panel().hidden).toBe(true);
		expect(frame.isConnected).toBe(true);

		setPagePopupLauncher(false, "en");
		expect(frame.isConnected).toBe(false);
		expect(document.getElementById("storylens-page-launcher")).toBeNull();
	});

	it("shows the chooser in its own frame without reloading the popup", async () => {
		const frame = openPopup();
		clickPage();

		const node = document.createElement("p");
		node.textContent = "Rand";
		document.body.append(node);
		const chooser = await pick(node);
		expect(chooser).not.toBe(frame);
		expect(chooser.src).toBe(`${POPUP}?view=selection&search=Rand`);
		expect(frame.isConnected).toBe(true);
		expect(frame.hidden).toBe(true);
		expect(panel().hidden).toBe(false);

		post(chooser, { type: "storylens-selection-close" });
		expect(chooser.isConnected).toBe(false);
		expect(panel().hidden).toBe(true);
		expect(popupFrame()).toBe(frame);
		expect(requests(frame)).toEqual([]);

		button().click();
		expect(frame.hidden).toBe(false);
		expect(panel().hidden).toBe(false);
	});

	it("opens a requested form in a new popup when none is kept", async () => {
		await requestForm("Rand");

		expect(frames()).toHaveLength(1);
		expect(popupFrame()?.src).toBe(`${POPUP}?${formQuery("Rand")}`);
		expect(panel().hidden).toBe(false);
	});
});

describe("form requested while a popup is kept", () => {
	it("asks the popup to load the form and never removes it itself", async () => {
		const frame = openPopup();
		clickPage();
		await requestForm("Rand");

		expect(popupFrame()).toBe(frame);
		expect(frame.hidden).toBe(false);
		expect(panel().hidden).toBe(false);
		expect(requests(frame)).toEqual([
			{
				type: POPUP_REQUEST_MESSAGE,
				id: expect.any(String),
				query: formQuery("Rand"),
				reload: true,
			},
		]);
		expect(frameWindow(frame).posted.at(-1)?.origin).toBe(ORIGIN);

		// The popup held nothing and loads the form in the same frame.
		answer(frame, false);
		expect(popupFrame()).toBe(frame);
		expect(notice().hidden).toBe(true);
	});

	it("keeps a form whose change it has not heard of yet", async () => {
		const frame = openPopup();
		// The reader edits the form; the state message is still on its way.
		clickPage();
		await requestForm("Rand");
		expect(frame.isConnected).toBe(true);

		// The late state message must not change the outcome either.
		report(frame, { dirty: true });
		expect(frame.isConnected).toBe(true);

		answer(frame, true);
		expect(popupFrame()).toBe(frame);
		expect(frame.src).toBe(POPUP);
		expect(panel().hidden).toBe(false);
		expect(notice().hidden).toBe(false);
		expect(notice().textContent).toBe("Save or close the open form first.");
	});

	it("keeps the popup when it does not answer", async () => {
		const frame = openPopup();
		report(frame, { dirty: false });
		clickPage();
		await requestForm("Rand");

		expect(popupFrame()).toBe(frame);
		expect(frames()).toHaveLength(1);
		expect(notice().hidden).toBe(true);
	});

	it("trusts only the answer to its latest request", async () => {
		const frame = openPopup();
		clickPage();
		await requestForm("Rand");
		const first = requests(frame)[0];
		clickPage();
		await requestForm("Perrin");
		expect(requests(frame).map((request) => request.query)).toEqual([
			formQuery("Rand"),
			formQuery("Perrin"),
		]);

		post(frame, { type: POPUP_ANSWER_MESSAGE, id: first.id, kept: true });
		expect(notice().hidden).toBe(true);
		post(
			frame,
			{ type: POPUP_ANSWER_MESSAGE, id: requests(frame)[1].id, kept: true },
			{ source: window },
		);
		expect(notice().hidden).toBe(true);

		answer(frame, true);
		expect(notice().hidden).toBe(false);
	});

	it("treats an answer without a clear 'nothing held' as kept", async () => {
		const frame = openPopup();
		clickPage();
		await requestForm("Rand");

		post(frame, { type: POPUP_ANSWER_MESSAGE, id: requests(frame)[0].id });
		expect(notice().hidden).toBe(false);
	});

	it("sends the request once a popup that is still loading announces itself", async () => {
		const frame = openPopup(false);
		clickPage();
		await requestForm("Rand");
		expect(popupFrame()).toBe(frame);
		expect(requests(frame)).toEqual([]);

		post(frame, { type: POPUP_READY_MESSAGE });
		expect(requests(frame).map((request) => request.query)).toEqual([
			formQuery("Rand"),
		]);
	});

	it("replaces a popup that never loaded", async () => {
		const frame = openPopup(false);
		clickPage();
		Date.now = () => now() + 6000;
		await requestForm("Rand");

		expect(frame.isConnected).toBe(false);
		expect(frames()).toHaveLength(1);
		expect(popupFrame()?.src).toBe(`${POPUP}?${formQuery("Rand")}`);
	});

	it("waits for the reloaded popup before sending the next request", async () => {
		const frame = openPopup();
		clickPage();
		await requestForm("Rand");
		answer(frame, false);

		clickPage();
		await requestForm("Perrin");
		expect(requests(frame)).toHaveLength(1);

		post(frame, { type: POPUP_READY_MESSAGE });
		expect(requests(frame).map((request) => request.query)).toEqual([
			formQuery("Rand"),
			formQuery("Perrin"),
		]);
	});
});

describe("launcher popup after an in-site navigation", () => {
	it("removes the popup only after it answers that it holds nothing", () => {
		const frame = openPopup();
		pagePopupLauncherNavigated();

		expect(panel().hidden).toBe(true);
		expect(frame.isConnected).toBe(true);
		expect(requests(frame)).toEqual([
			{
				type: POPUP_REQUEST_MESSAGE,
				id: expect.any(String),
				query: "",
				reload: false,
			},
		]);

		answer(frame, false);
		expect(frame.isConnected).toBe(false);

		const next = openPopup();
		expect(next).not.toBe(frame);
		expect(next.src).toBe(POPUP);
	});

	it("keeps a form whose change it has not heard of yet", () => {
		const frame = openPopup();
		// Edited a moment before the navigation; no state message arrived.
		pagePopupLauncherNavigated();
		answer(frame, true);
		expect(frame.isConnected).toBe(true);

		button().click();
		expect(popupFrame()).toBe(frame);
		expect(panel().hidden).toBe(false);
	});

	it("asks again when the kept popup is closed, and removes it once its work is gone", () => {
		const frame = openPopup();
		report(frame, { dirty: true });
		pagePopupLauncherNavigated();
		answer(frame, true);

		button().click();
		// The form is saved while the reader looks at it: nothing reloads under them.
		report(frame, { dirty: false });
		expect(frame.isConnected).toBe(true);
		expect(requests(frame)).toHaveLength(1);

		clickPage();
		expect(requests(frame)).toHaveLength(2);
		expect(frame.isConnected).toBe(true);
		answer(frame, false);
		expect(frame.isConnected).toBe(false);
		expect(openPopup()).not.toBe(frame);
	});

	it("asks again when a kept popup's work ends while it is closed", () => {
		const frame = openPopup();
		report(frame, { dirty: true, working: true });
		pagePopupLauncherNavigated();
		answer(frame, true);

		report(frame, { dirty: false, working: false });
		expect(requests(frame)).toHaveLength(2);
		answer(frame, false);
		expect(frame.isConnected).toBe(false);
		expect(status().hidden).toBe(true);
	});

	it("does not remove a popup the reader opened before it answered", () => {
		const frame = openPopup();
		pagePopupLauncherNavigated();
		button().click();
		answer(frame, false);

		expect(frame.isConnected).toBe(true);
		expect(panel().hidden).toBe(false);

		// It is still out of date, so closing it asks once more.
		clickPage();
		answer(frame, false);
		expect(frame.isConnected).toBe(false);
	});

	it("loads a requested form in the out-of-date popup instead of removing it", async () => {
		const frame = openPopup();
		pagePopupLauncherNavigated();
		await requestForm("Rand");
		expect(requests(frame).at(-1)?.reload).toBe(true);
		answer(frame, false);
		post(frame, { type: POPUP_READY_MESSAGE });
		const sent = requests(frame).length;

		// The reloaded popup detected the new page; closing it asks nothing more.
		clickPage();
		expect(requests(frame)).toHaveLength(sent);
		expect(frame.isConnected).toBe(true);
	});
});

describe("launcher status dot", () => {
	it("shows a running AI request only while the popup is out of sight", () => {
		const frame = openPopup();
		report(frame, { dirty: true, working: true });
		expect(status().hidden).toBe(true);

		clickPage();
		expect(status().hidden).toBe(false);
		expect(status().dataset.state).toBe("working");
		expect(button().getAttribute("aria-label")).toBe(
			"Open Story Lens (AI is working)",
		);

		button().click();
		expect(status().hidden).toBe(true);
		expect(button().getAttribute("aria-label")).toBe("Open Story Lens");
	});

	it("marks a finished request until the popup is opened", () => {
		const frame = openPopup();
		report(frame, { dirty: true, working: true });
		clickPage();

		// The generated image is now unsaved work in the form.
		report(frame, { dirty: true, working: false });
		expect(status().dataset.state).toBe("ready");
		expect(button().title).toBe("Open Story Lens (AI result is ready)");

		button().click();
		expect(status().hidden).toBe(true);
		clickPage();
		expect(status().hidden).toBe(true);
		expect(popupFrame()).toBe(frame);
	});

	it("marks a failed request", () => {
		const frame = openPopup();
		report(frame, { dirty: true, working: true });
		clickPage();
		report(frame, { dirty: false, working: false, failed: true });

		expect(status().dataset.state).toBe("failed");
		expect(button().getAttribute("aria-label")).toBe(
			"Open Story Lens (AI request failed)",
		);
	});

	it("does not mark a request that ends while the popup is visible", () => {
		const frame = openPopup();
		report(frame, { dirty: true, working: true });
		report(frame, { dirty: true, working: false });
		clickPage();

		expect(status().hidden).toBe(true);
	});

	it("shows progress while the chooser covers the popup", async () => {
		const frame = openPopup();
		report(frame, { dirty: true, working: true });
		clickPage();
		const node = document.createElement("p");
		node.textContent = "Rand";
		document.body.append(node);
		await pick(node);

		expect(panel().hidden).toBe(false);
		expect(status().dataset.state).toBe("working");
	});

	it("clears when the popup reloads for a requested form", async () => {
		const frame = openPopup();
		report(frame, { dirty: true, working: true });
		clickPage();
		report(frame, { dirty: false, working: false });
		expect(status().dataset.state).toBe("ready");

		await requestForm("Rand");
		answer(frame, false);
		clickPage();
		expect(status().hidden).toBe(true);
	});

	it("follows the launcher language", () => {
		const frame = openPopup();
		report(frame, { dirty: true, working: true });
		clickPage();
		setPagePopupLauncher(true, "ar");

		expect(button().getAttribute("aria-label")).toBe(
			"افتح عدسة القصة (الذكاء الاصطناعي يعمل)",
		);
	});
});

describe("launcher popup messages", () => {
	it("ignores state from other windows, other origins and other messages", () => {
		const frame = openPopup();
		clickPage();
		const state = { type: POPUP_STATE_MESSAGE, dirty: true, working: true };

		post(frame, state, { source: window });
		post(frame, state, { source: null });
		post(frame, state, { origin: "https://novels.example.invalid" });
		post(frame, { type: "storylens-selection-close" });
		post(frame, "storylens-popup-state");
		expect(status().hidden).toBe(true);
	});

	it("ignores an answer the novel page sends", () => {
		const frame = openPopup();
		pagePopupLauncherNavigated();
		const { id } = requests(frame)[0];

		post(
			frame,
			{ type: POPUP_ANSWER_MESSAGE, id, kept: false },
			{ source: window },
		);
		post(
			frame,
			{ type: POPUP_ANSWER_MESSAGE, id, kept: false },
			{ origin: "https://novels.example.invalid" },
		);
		expect(frame.isConnected).toBe(true);
	});

	it("ignores messages from a popup frame it already removed", () => {
		const frame = openPopup();
		pagePopupLauncherNavigated();
		answer(frame, false);
		const next = openPopup();
		clickPage();

		report(frame, { dirty: true, working: true });
		expect(status().hidden).toBe(true);
		report(next, { dirty: true, working: true });
		expect(status().dataset.state).toBe("working");
	});
});
