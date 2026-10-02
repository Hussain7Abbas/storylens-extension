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
const { pageAiTasks } = await import("../../src/lib/launcher-frame/ai-tasks");

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

/** The popup frames (tabs): every frame but the selection chooser. */
function popupFrames(): HTMLIFrameElement[] {
	return frames().filter((frame) => !frame.src.includes("view=selection"));
}

/** The first popup frame. */
function popupFrame(): HTMLIFrameElement | undefined {
	return popupFrames()[0];
}

/** The popup tab the panel shows. */
function shownFrame(): HTMLIFrameElement | undefined {
	return popupFrames().find((frame) => !frame.hidden);
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
	pageAiTasks.drop(() => true);
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

		// The form opens in a tab of its own; the kept one stays as it was.
		answer(frame, true);
		expect(popupFrame()).toBe(frame);
		expect(frame.src).toBe(POPUP);
		expect(frame.hidden).toBe(true);
		expect(popupFrames()).toHaveLength(2);
		expect(shownFrame()?.src).toBe(`${POPUP}?${formQuery("Rand")}`);
		expect(panel().hidden).toBe(false);
		expect(notice().hidden).toBe(true);
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
		expect(popupFrames()).toHaveLength(1);
		post(
			frame,
			{ type: POPUP_ANSWER_MESSAGE, id: requests(frame)[1].id, kept: true },
			{ source: window },
		);
		expect(popupFrames()).toHaveLength(1);

		answer(frame, true);
		expect(popupFrames()).toHaveLength(2);
		expect(shownFrame()?.src).toBe(`${POPUP}?${formQuery("Perrin")}`);
	});

	it("treats an answer without a clear 'nothing held' as kept", async () => {
		const frame = openPopup();
		clickPage();
		await requestForm("Rand");

		post(frame, { type: POPUP_ANSWER_MESSAGE, id: requests(frame)[0].id });
		expect(popupFrames()).toHaveLength(2);
		expect(frame.isConnected).toBe(true);
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

describe("launcher near an edge", () => {
	it("stays visible for 3 seconds after it appears, then tucks", async () => {
		setPagePopupLauncher(false, "en");
		await fakeBrowser.storage.local.set({
			"storylens-page-launcher-position": { x: 0, y: 100 },
		});
		const realSetTimeout = globalThis.setTimeout;
		const reveals: (() => void)[] = [];
		globalThis.setTimeout = ((handler: () => void, delay?: number) => {
			if (delay === 3000) {
				reveals.push(handler);
				return 0;
			}
			return realSetTimeout(handler, delay);
		}) as typeof setTimeout;
		try {
			setPagePopupLauncher(true, "en");
		} finally {
			globalThis.setTimeout = realSetTimeout;
		}
		try {
			// The saved position at the left edge is restored asynchronously.
			await new Promise((resolve) => setTimeout(resolve, 5));
			const host = document.getElementById("storylens-page-launcher");
			// Clamped 8 px from the edge, inside the 10 px tuck range.
			expect(host?.style.left).toBe("8px");
			expect(button().style.transform).toBe("");

			expect(reveals).toHaveLength(1);
			reveals[0]?.();
			expect(button().style.transform).toMatch(/^translate\(/);
		} finally {
			fakeBrowser.storage.local.reset();
		}
	});
});

describe("AI tasks under the launcher", () => {
	type Source = "popup" | "panel" | "page";
	type Operation = "generate-image" | "suggest-keyword" | "summarize";
	// Task IDs are single-use, so each test gets its own.
	let run = 0;
	beforeEach(() => {
		run += 1;
	});
	const key = (id: string) => `${run}-${id}`;
	const tasks = () => element("#tasks");
	const rows = () => [...tasks().querySelectorAll<HTMLElement>(".task")];
	const texts = () => rows().map((row) => row.textContent);
	const start = (
		id: string,
		{
			source = "popup",
			operation = "generate-image",
			subject = "Rand",
			frame,
		}: {
			source?: Source;
			operation?: Operation;
			subject?: string;
			frame?: string;
		} = {},
	) =>
		pageAiTasks.apply({
			id: key(id),
			state: "working",
			operation,
			subject,
			source,
			...(frame ? { frame: key(frame) } : {}),
		});
	const finish = (
		id: string,
		{
			source = "popup",
			state = "done",
			at = Date.now(),
		}: { source?: Source; state?: "done" | "failed"; at?: number } = {},
	) =>
		pageAiTasks.apply(
			{
				id: key(id),
				state,
				operation: "generate-image",
				subject: "Rand",
				source,
			},
			at,
		);
	const release = (id: string, source: Source = "popup") =>
		pageAiTasks.apply({ id: key(id), state: "released", source });
	/** Opens the popup, whose document announces `name` as its task key. */
	const openKeyed = (name: string) => {
		button().click();
		const frame = shownFrame();
		if (!frame) throw new Error("popup frame is missing");
		post(frame, { type: POPUP_READY_MESSAGE, key: key(name) });
		return frame;
	};
	/** Whether leaving the page now would ask the reader first. */
	const leavingAsks = () => {
		const event = new Event("beforeunload", { cancelable: true });
		window.dispatchEvent(event);
		return event.defaultPrevented;
	};

	it("releases a held result when the popup reloads itself with a new document key", () => {
		const frame = openKeyed("old-document");
		clickPage();
		start("a", { frame: "old-document" });
		finish("a");
		expect(leavingAsks()).toBe(true);

		// Repeating the same document's ready message must preserve its result.
		post(frame, { type: POPUP_READY_MESSAGE, key: key("old-document") });
		expect(leavingAsks()).toBe(true);

		// Selector saves reload the iframe directly, without a launcher request.
		post(frame, { type: POPUP_READY_MESSAGE, key: key("new-document") });
		expect(pageAiTasks.unsaved()).toBe(false);
		expect(leavingAsks()).toBe(false);
		expect(rows()).toEqual([]);
	});

	it("drops only the replaced popup document's tasks on reload", () => {
		const frame = openKeyed("old-document");
		clickPage();
		start("popup", { frame: "old-document" });
		start("page", { source: "page", operation: "summarize" });
		start("panel", { source: "panel" });
		start("other-popup", { frame: "other-document" });

		post(frame, { type: POPUP_READY_MESSAGE, key: key("new-document") });
		expect(pageAiTasks.shown().map((task) => task.id)).toEqual([
			key("page"),
			key("panel"),
			key("other-popup"),
		]);
		expect(leavingAsks()).toBe(true);
	});

	it("lists a running task under the button without hovering, then checks it off", () => {
		expect(tasks().hidden).toBe(true);
		start("a");
		expect(tasks().hidden).toBe(false);
		expect(element("#actions").hidden).toBe(true);
		expect(rows()).toHaveLength(1);
		const [row] = rows();
		expect(row?.dataset.state).toBe("working");
		expect(row?.textContent).toBe("Rand - Generating image");
		expect(row?.querySelector("svg")).not.toBeNull();
		// The launcher sits in the top half, so the list opens below it.
		expect(tasks().dataset.side).toBe("below");

		finish("a");
		expect(rows()).toEqual([row as HTMLElement]);
		expect(row?.dataset.state).toBe("done");
		expect(row?.textContent).toBe("Rand - Generating image (done)");
		expect(row?.title).toBe("Rand - Generating image (done)");
	});

	it("lists every running task and names the operation alone without a subject", () => {
		start("a");
		start("b", { source: "page", operation: "summarize", subject: "" });
		start("c", {
			source: "panel",
			operation: "suggest-keyword",
			subject: "Mat",
		});
		expect(texts()).toEqual([
			"Rand - Generating image",
			"Summarizing page",
			"Mat - Generating keyword",
		]);
		finish("b", { source: "page", state: "failed" });
		expect(rows()[1]?.dataset.state).toBe("failed");
	});

	it("moves past the action row while it is open", async () => {
		start("a");
		button().dispatchEvent(new PointerEvent("pointerenter"));
		await new Promise((resolve) => setTimeout(resolve, 250));
		expect(element("#actions").hidden).toBe(false);
		expect(tasks().hasAttribute("data-shifted")).toBe(true);
	});

	it("shows a tab's requests on its card and drops the results the reader saw", () => {
		openKeyed("tab");
		clickPage();
		start("a", { frame: "tab" });
		start("b", { frame: "tab", operation: "suggest-keyword", subject: "Mat" });
		// One card per tab: its latest request, spinning while any runs.
		expect(texts()).toEqual(["Mat - Generating keyword"]);
		finish("b");
		expect(rows()[0]?.dataset.state).toBe("working");
		finish("a");
		expect(rows()[0]?.dataset.state).toBe("done");

		button().click();
		expect(tasks().hidden).toBe(true);
		clickPage();
		// Both results were on screen; one tab with nothing running needs no card.
		expect(rows()).toEqual([]);
	});

	it("opens the tab of a card", () => {
		const frame = openKeyed("tab");
		clickPage();
		start("a", { frame: "tab" });
		const row = rows()[0];
		if (!(row instanceof HTMLButtonElement))
			throw new Error("a tab card is a button");
		row.click();
		expect(panel().hidden).toBe(false);
		expect(shownFrame()).toBe(frame);
	});

	it("opens the shown tab from a popup task of an unknown document", () => {
		start("a");
		finish("a");
		const row = rows()[0];
		if (!(row instanceof HTMLButtonElement))
			throw new Error("a popup task is a button");
		row.click();
		expect(panel().hidden).toBe(false);
		expect(shownFrame()).toBeDefined();
	});

	it("removes a finished summary after a while and keeps a popup result", async () => {
		start("a");
		finish("a", { at: Date.now() - 60_000 });
		start("b", { source: "page", operation: "summarize" });
		finish("b", { source: "page", at: Date.now() - 8000 });
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(texts()).toEqual(["Rand - Generating image (done)"]);
	});

	it("removes a cancelled request at once", () => {
		start("a");
		release("a");
		expect(rows()).toEqual([]);
		expect(tasks().hidden).toBe(true);
	});

	it("asks before leaving while a request runs or its result is unsaved", () => {
		expect(leavingAsks()).toBe(false);
		start("a");
		expect(leavingAsks()).toBe(true);
		finish("a");
		expect(leavingAsks()).toBe(true);
		release("a");
		expect(leavingAsks()).toBe(false);

		start("b");
		finish("b", { state: "failed" });
		expect(leavingAsks()).toBe(false);
	});

	it("asks before leaving while a popup tab holds unsaved changes", () => {
		const frame = openPopup();
		report(frame, { dirty: true });
		expect(leavingAsks()).toBe(true);
		report(frame, { dirty: false });
		expect(leavingAsks()).toBe(false);
	});

	it("forgets a tab's tasks with its frame and stops asking with the launcher", () => {
		const frame = openKeyed("tab");
		clickPage();
		start("a", { frame: "tab" });
		release("a");
		start("b", { source: "page", operation: "summarize", subject: "" });
		pagePopupLauncherNavigated();
		answer(frame, false);
		expect(frame.isConnected).toBe(false);
		expect(texts()).toEqual(["Summarizing page"]);

		setPagePopupLauncher(false, "en");
		expect(leavingAsks()).toBe(false);
		// A new launcher lists what still runs in the page.
		setPagePopupLauncher(true, "en");
		expect(texts()).toEqual(["Summarizing page"]);
		expect(leavingAsks()).toBe(true);
	});

	it("follows the launcher language", () => {
		start("a", { source: "page", operation: "summarize", subject: "الفصل" });
		setPagePopupLauncher(true, "ar");
		expect(rows()[0]?.dir).toBe("rtl");
		expect(rows()[0]?.textContent).toBe("الفصل - تلخيص الصفحة");
	});
});

describe("popup tabs", () => {
	const rows = () => [
		...element("#tasks").querySelectorAll<HTMLButtonElement>("button.task"),
	];
	const texts = () => rows().map((row) => row.textContent);

	/** Picks `text` and asks for its keyword form with AI, as the chooser does. */
	async function requestCharacter(text: string): Promise<void> {
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
	}

	it("opens a form in a new tab at once while the shown tab is known to hold work", async () => {
		const first = openPopup();
		report(first, { dirty: true, working: true });
		clickPage();
		await requestCharacter("Rand");

		// Nothing needs asking: a new tab replaces nothing.
		expect(requests(first)).toEqual([]);
		expect(popupFrames()).toHaveLength(2);
		expect(first.hidden).toBe(true);
		const second = shownFrame();
		expect(second?.src).toBe(`${POPUP}?${formQuery("Rand")}`);
		if (!second) throw new Error("the new tab is missing");
		post(second, { type: POPUP_READY_MESSAGE });
		report(second, { dirty: true, working: true });

		clickPage();
		await requestCharacter("Mat");
		expect(popupFrames()).toHaveLength(3);
		expect(shownFrame()?.src).toBe(`${POPUP}?${formQuery("Mat")}`);
		clickPage();

		// Every tab has a card; the one the button opens is marked.
		expect(texts()).toEqual([
			"Story Lens",
			"Rand - New keyword",
			"Mat - New keyword",
		]);
		expect(rows()[2]?.getAttribute("aria-current")).toBe("true");
		// Two tabs run AI requests out of sight.
		expect(status().dataset.state).toBe("working");
	});

	it("switches tabs from their cards and keeps each one as it was", async () => {
		const first = openPopup();
		report(first, { dirty: true });
		clickPage();
		await requestCharacter("Rand");
		const second = shownFrame();
		if (!second) throw new Error("the new tab is missing");
		post(second, { type: POPUP_READY_MESSAGE });
		report(second, { dirty: true });
		clickPage();

		rows()[0]?.click();
		expect(panel().hidden).toBe(false);
		expect(shownFrame()).toBe(first);
		expect(second.hidden).toBe(true);
		expect(frameWindow(first).posted.at(-1)?.message).toEqual({
			type: POPUP_SHOWN_MESSAGE,
		});

		clickPage();
		button().click();
		// The launcher button opens the tab shown last.
		expect(shownFrame()).toBe(first);
	});

	it("removes a tab out of sight once it answers that it holds nothing", async () => {
		const first = openPopup();
		report(first, { dirty: true });
		clickPage();
		await requestCharacter("Rand");
		const second = shownFrame();
		if (!second) throw new Error("the new tab is missing");
		post(second, { type: POPUP_READY_MESSAGE });
		clickPage();

		// The reader saves the first tab's form while it is out of sight.
		report(first, { dirty: false });
		expect(requests(first).at(-1)).toMatchObject({ query: "", reload: false });
		answer(first, false);
		expect(first.isConnected).toBe(false);
		expect(popupFrames()).toEqual([second]);
		// One tab left: no cards.
		expect(rows()).toEqual([]);
	});

	it("keeps a tab out of sight whose AI result was not looked at", async () => {
		const first = openPopup();
		post(first, { type: POPUP_READY_MESSAGE, key: "first-tab" });
		report(first, { dirty: true, working: true });
		pageAiTasks.apply({
			id: "tab-task",
			state: "working",
			operation: "suggest-keyword",
			subject: "Rand",
			source: "popup",
			frame: "first-tab",
		});
		clickPage();
		await requestCharacter("Mat");
		post(shownFrame() as HTMLIFrameElement, { type: POPUP_READY_MESSAGE });
		clickPage();

		pageAiTasks.apply({
			id: "tab-task",
			state: "failed",
			operation: "suggest-keyword",
			subject: "Rand",
			source: "popup",
		});
		report(first, { dirty: false, working: false, failed: true });
		expect(requests(first)).toEqual([]);
		expect(texts()[0]).toBe("Rand - Generating keyword (failed)");
	});

	it("stops opening tabs at the limit and says so", async () => {
		const first = openPopup();
		report(first, { dirty: true });
		clickPage();
		for (const name of ["A", "B", "C", "D", "E"]) {
			await requestCharacter(name);
			const tab = shownFrame();
			if (!tab) throw new Error("the new tab is missing");
			post(tab, { type: POPUP_READY_MESSAGE });
			report(tab, { dirty: true });
			clickPage();
		}
		expect(popupFrames()).toHaveLength(6);

		await requestCharacter("F");
		const shown = shownFrame();
		if (!shown) throw new Error("no tab is shown");
		// At the limit the shown tab is asked; it holds work, so nothing opens.
		answer(shown, true);
		expect(popupFrames()).toHaveLength(6);
		expect(notice().hidden).toBe(false);
		expect(notice().textContent).toBe(
			"Save or close one of the open forms first.",
		);
	});
});

describe("AI form from a text pick", () => {
	const rows = () => [
		...element("#tasks").querySelectorAll<HTMLElement>(".task"),
	];
	const texts = () => rows().map((row) => row.textContent);
	let run = 0;
	beforeEach(() => {
		run += 1;
	});
	/** Picks `text` and asks for its keyword form with AI, as the chooser does. */
	async function requestAiForm(text: string): Promise<HTMLIFrameElement> {
		const node = document.createElement("p");
		node.textContent = `Before ${text} after.`;
		document.body.append(node);
		const word = document.createElement("span");
		word.textContent = text;
		node.replaceChildren("Before ", word, " after.");
		const chooser = await pick(word);
		post(chooser, {
			type: "storylens-selection-create",
			kind: "keyword",
			novelId: "novel-1",
			ai: true,
		});
		expect(chooser.isConnected).toBe(false);
		const frame = popupFrames().at(-1);
		if (!frame) throw new Error("the form's tab is missing");
		frameWindow(frame);
		return frame;
	}
	const task = (
		frame: string,
		state: "working" | "done" | "failed",
		subject = "Rand",
	) =>
		pageAiTasks.apply({
			id: `${run}-${frame}`,
			state,
			operation: "suggest-keyword",
			subject,
			source: "popup",
			frame: `${run}-${frame}`,
		});
	const ready = (frame: HTMLIFrameElement, name: string) =>
		post(frame, { type: POPUP_READY_MESSAGE, key: `${run}-${name}` });

	it("loads the form out of sight with a spinner card, then opens it with the answer", async () => {
		const frame = await requestAiForm("Rand");
		expect(panel().hidden).toBe(true);
		expect(frame.hidden).toBe(true);
		expect(frame.src).toContain("create=keyword");
		expect(frame.src).toContain("aiContext=");
		expect(texts()).toEqual(["Rand - Generating keyword"]);
		expect(rows()[0]?.dataset.state).toBe("working");

		ready(frame, "bg");
		report(frame, { dirty: true, working: true });
		task("bg", "working");
		expect(panel().hidden).toBe(true);
		expect(element("#tasks").hidden).toBe(false);

		task("bg", "done");
		report(frame, { dirty: true, working: false });
		expect(panel().hidden).toBe(false);
		expect(shownFrame()).toBe(frame);
		expect(button().getAttribute("aria-expanded")).toBe("true");
	});

	it("also opens the form when the AI request fails, for a manual entry", async () => {
		const frame = await requestAiForm("Rand");
		ready(frame, "bg");
		task("bg", "working");
		expect(panel().hidden).toBe(true);
		task("bg", "failed");
		expect(shownFrame()).toBe(frame);
		expect(panel().hidden).toBe(false);
	});

	it("keeps its card instead while the reader uses another popup", async () => {
		const first = openPopup();
		clickPage();
		const frame = await requestAiForm("Rand");
		expect(popupFrames()).toEqual([first, frame]);
		ready(frame, "bg");
		task("bg", "working");
		report(frame, { dirty: true, working: true });

		button().click();
		expect(shownFrame()).toBe(first);
		task("bg", "done");
		report(frame, { dirty: true, working: false });
		expect(shownFrame()).toBe(first);

		clickPage();
		expect(panel().hidden).toBe(true);
		expect(status().dataset.state).toBe("ready");
		expect(texts()).toContain("Rand - Generating keyword (done)");
		// Closing the reader's popup does not throw the finished form at them.
		expect(frame.hidden).toBe(true);
	});

	it("does not open again by itself once the reader opened it early", async () => {
		const frame = await requestAiForm("Rand");
		ready(frame, "bg");
		task("bg", "working");
		report(frame, { dirty: true, working: true });
		rows()[0]?.click();
		expect(shownFrame()).toBe(frame);
		clickPage();

		task("bg", "done");
		report(frame, { dirty: true, working: false });
		expect(panel().hidden).toBe(true);
	});

	it("is never asked to go while it waits for its answer", async () => {
		const frame = await requestAiForm("Rand");
		ready(frame, "bg");
		clickPage();
		report(frame, { dirty: false, working: false });
		expect(requests(frame)).toEqual([]);
		expect(frame.isConnected).toBe(true);
	});

	it("opens the form the usual way when AI is off", async () => {
		await requestForm("Rand");
		expect(panel().hidden).toBe(false);
	});
});
