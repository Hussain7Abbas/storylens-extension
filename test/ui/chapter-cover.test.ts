/// <reference types="bun" />
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ChapterContextRecord } from "../../src/lib/chapter-context/schema";
import { coverChapter } from "../helpers/chapter-cover";
import { readyCoverContext } from "../helpers/cover-context";
import { fakeBrowser, resetFakeBrowser } from "../helpers/fake-browser";

const registeredHere = !GlobalRegistrator.isRegistered;
if (registeredHere)
	GlobalRegistrator.register({
		url: "https://novels.example.invalid/chapter/12",
	});
Object.assign(globalThis, {
	browser: fakeBrowser,
	chrome: { runtime: { id: fakeBrowser.runtime.id } },
});
const { clearChapterCover, syncChapterCover, startChapterCover } = await import(
	"../../src/lib/chapter-cover/page"
);
const runtime = fakeBrowser.runtime as unknown as {
	sendMessage: (message: unknown) => Promise<unknown>;
};
const originalSend = runtime.sendMessage;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
const sent: { type: string; data?: Record<string, unknown> }[] = [];
let hasCover: boolean;
let contextRecord: ChapterContextRecord;
let waiting: boolean;
let generateReply:
	| ReturnType<typeof Promise.withResolvers<unknown>>
	| undefined;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const root = () =>
	document.getElementById("storylens-chapter-cover")?.shadowRoot;
const button = (label: string) =>
	[...(root()?.querySelectorAll("button") ?? [])].find((button) =>
		button.textContent?.startsWith(label),
	);

beforeEach(async () => {
	resetFakeBrowser();
	clearChapterCover();
	sent.length = 0;
	hasCover = false;
	contextRecord = readyCoverContext();
	waiting = false;
	generateReply = undefined;
	document.body.innerHTML =
		'<article class="chapter-content">Mira raises her sword on the bridge.</article>';
	URL.createObjectURL = () => "blob:cover-preview";
	URL.revokeObjectURL = () => {};
	await fakeBrowser.storage.local.set({
		"storylens-ai-source": "desktop",
		"storylens-ai-image-source": "desktop",
		"storylens-desktop-client": {
			token: "paired",
			model: "",
			effort: "",
			port: 43127,
		},
		"storylens-auth": JSON.stringify({
			token: "token",
			user: {
				id: "reader",
				email: "reader@example.invalid",
				username: "reader",
				name: "Reader",
				isGuest: false,
				role: { slug: "reader" },
				permissions: [],
			},
		}),
	});
	runtime.sendMessage = async (message) => {
		const data = message as { type: string; data?: Record<string, unknown> };
		sent.push(data);
		if (data.type === "readChapterContext") return { res: contextRecord };
		if (data.type === "chapterCoverKeywords")
			return { res: coverChapter().keywords };
		if (data.type === "chapterCover") {
			const action = data.data?.action;
			if (action === "read")
				return {
					res: {
						image: hasCover
							? { id: "cover", url: "https://images.example.invalid/cover.png" }
							: null,
						generating: waiting,
					},
				};
			if (action === "claim")
				return { res: { image: null, generating: true, token: "lease" } };
			if (action === "publish") {
				hasCover = true;
				return {
					res: {
						image: {
							id: "cover",
							url: "https://images.example.invalid/cover.png",
						},
						generating: false,
					},
				};
			}
			return { res: { image: null, generating: false } };
		}
		if (data.type === "generateAiImage") {
			if (generateReply) return generateReply.promise;
			return {
				res: {
					ok: true,
					value: { data: btoa("image"), mimeType: "image/png" },
				},
			};
		}
		return { res: undefined };
	};
});
afterEach(() => {
	clearChapterCover();
	runtime.sendMessage = originalSend;
	URL.createObjectURL = originalCreate;
	URL.revokeObjectURL = originalRevoke;
});
afterAll(() => {
	if (registeredHere) GlobalRegistrator.unregister();
});

test("default off does not generate an absent cover; an existing shared cover appears before chapter text", async () => {
	syncChapterCover(coverChapter());
	await tick();
	expect(sent.some((item) => item.type === "generateAiImage")).toBe(false);
	expect(root()).toBeUndefined();
	hasCover = true;
	syncChapterCover(coverChapter());
	await tick();
	expect(document.querySelector("article")?.previousElementSibling?.id).toBe(
		"storylens-chapter-cover",
	);
	expect(root()?.querySelector("img")?.src).toContain("cover.png");
	expect(sent.some((item) => item.type === "readChapterContext")).toBe(false);
	expect(sent.some((item) => item.data?.action === "claim")).toBe(false);
});
test("cover lookup adds nothing to the DOM until a saved cover is found", async () => {
	const pending = Promise.withResolvers<unknown>();
	const reply = runtime.sendMessage;
	runtime.sendMessage = async (message) => {
		const item = message as { type: string; data?: { action?: string } };
		return item.type === "chapterCover" && item.data?.action === "read"
			? pending.promise
			: reply(message);
	};
	syncChapterCover(coverChapter());
	await tick();
	expect(sent.some((item) => item.type === "chapterCoverKeywords")).toBe(false);
	expect(document.getElementById("storylens-chapter-cover")).toBeNull();
	expect(document.body.textContent).toBe(
		"Mira raises her sword on the bridge.",
	);
	pending.resolve({
		res: {
			image: { id: "cover", url: "https://images.example.invalid/cover.png" },
			generating: false,
		},
	});
	await tick();
	expect(root()?.querySelector("img")?.src).toContain("cover.png");
	expect(root()?.querySelector('[role="status"]')?.textContent).toBe("");
});
test("a lookup completed after disposal cannot add a cover to the DOM", async () => {
	const pending = Promise.withResolvers<unknown>();
	const reply = runtime.sendMessage;
	runtime.sendMessage = async (message) => {
		const item = message as { type: string; data?: { action?: string } };
		return item.type === "chapterCover" && item.data?.action === "read"
			? pending.promise
			: reply(message);
	};
	syncChapterCover(coverChapter());
	await tick();
	clearChapterCover();
	pending.resolve({
		res: {
			image: { id: "cover", url: "https://images.example.invalid/cover.png" },
			generating: false,
		},
	});
	await tick();
	expect(document.getElementById("storylens-chapter-cover")).toBeNull();
});
test("a saved cover is a bare image with its actions inside the corner disclosure", async () => {
	hasCover = true;
	syncChapterCover(coverChapter());
	await tick();
	const shadow = root();
	expect(shadow?.querySelector("header,section,h1,h2,figure")).toBeNull();
	expect(button("Close")).toBeUndefined();
	expect(shadow?.querySelector("img")?.parentNode).toBe(shadow);
	expect(shadow?.querySelector('[role="status"]')?.textContent).toBe("");
	const menu = shadow?.querySelector("details");
	expect(menu?.open).toBe(false);
	expect(menu?.querySelector("summary")?.getAttribute("aria-label")).toBe(
		"Chapter cover actions",
	);
	expect(menu?.contains(button("Copy image prompt") ?? null)).toBe(true);
	expect(menu?.querySelector("a")?.textContent).toBe("Download image");
});
test("cover actions dismiss with Escape or an outside pointer, returning keyboard focus on Escape", async () => {
	hasCover = true;
	syncChapterCover(coverChapter());
	await tick();
	const menu = root()?.querySelector("details");
	const trigger = menu?.querySelector("summary");
	if (!menu || !trigger) throw new Error("Cover actions missing");
	menu.open = true;
	button("Copy image prompt")?.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
		}),
	);
	expect(menu.open).toBe(false);
	expect(root()?.activeElement).toBe(trigger);
	menu.open = true;
	document.body.dispatchEvent(
		new PointerEvent("pointerdown", { bubbles: true }),
	);
	expect(menu.open).toBe(false);
});
test("cover interaction does not open the novel site's page-click controls", async () => {
	hasCover = true;
	syncChapterCover(coverChapter());
	await tick();
	let pageClicks = 0;
	const onClick = () => pageClicks++;
	document.addEventListener("click", onClick);
	try {
		root()
			?.querySelector("img")
			?.dispatchEvent(
				new MouseEvent("click", {
					bubbles: true,
					composed: true,
				}),
			);
		expect(pageClicks).toBe(0);
	} finally {
		document.removeEventListener("click", onClick);
	}
});
test("auto mode generates once, includes references, saves shared artwork and then reuses it", async () => {
	await fakeBrowser.storage.local.set({ "storylens-auto-chapter-cover": true });
	syncChapterCover({ ...coverChapter(), keywords: [] });
	await tick();
	await tick();
	expect(sent.filter((item) => item.type === "generateAiImage")).toHaveLength(
		1,
	);
	const request = sent.find((item) => item.type === "generateAiImage")?.data;
	expect(request?.feature).toBe("chapter_cover");
	expect(request?.model).toBe("codex");
	expect(request?.prompt).toContain("Mira raises her sword");
	expect(request?.referenceImageUrls).toEqual([
		"https://images.example.invalid/armored-mira.png",
	]);
	expect(sent.some((item) => item.data?.action === "publish")).toBe(true);
	expect(button("Copy image prompt")?.disabled).toBe(false);
	clearChapterCover();
	syncChapterCover(coverChapter());
	await tick();
	expect(sent.filter((item) => item.type === "generateAiImage")).toHaveLength(
		1,
	);
});
test("a shared generation in progress does not start a second request", async () => {
	waiting = true;
	await fakeBrowser.storage.local.set({ "storylens-auto-chapter-cover": true });
	syncChapterCover(coverChapter());
	await tick();
	expect(root()).toBeUndefined();
	expect(sent.some((item) => item.data?.action === "claim")).toBe(false);
	startChapterCover();
	expect(root()?.textContent).toContain("Another reader");
	expect(button("Generate Chapter Cover Image")?.disabled).toBe(true);
});
test("Stop cancels the image request, releases the lease and ignores a late result", async () => {
	generateReply = Promise.withResolvers<unknown>();
	syncChapterCover(coverChapter());
	await tick();
	startChapterCover();
	await tick();
	await tick();
	button("Stop")?.click();
	await tick();
	expect(sent.some((item) => item.type === "cancelAiPrompt")).toBe(true);
	expect(sent.some((item) => item.data?.action === "release")).toBe(true);
	generateReply.resolve({
		res: { ok: true, value: { data: btoa("late"), mimeType: "image/png" } },
	});
	await tick();
	expect(sent.some((item) => item.data?.action === "publish")).toBe(false);
	expect(root()?.textContent).toContain("Image generation stopped.");
});

test("regeneration keeps the saved background visible, sends an explicit claim, and blocks duplicate clicks", async () => {
	hasCover = true;
	generateReply = Promise.withResolvers<unknown>();
	syncChapterCover(coverChapter());
	await tick();
	const regenerate = button("Regenerate background image");
	expect(regenerate?.hidden).toBe(false);
	regenerate?.click();
	regenerate?.click();
	await tick();
	expect(root()?.querySelector("img")?.src).toContain("cover.png");
	expect(regenerate?.disabled).toBe(true);
	expect(sent.filter((item) => item.type === "generateAiImage")).toHaveLength(
		1,
	);
	expect(
		sent.find((item) => item.data?.action === "claim")?.data?.regenerate,
	).toBe(true);
	generateReply.resolve({
		res: { ok: true, value: { data: btoa("new"), mimeType: "image/png" } },
	});
	await tick();
	expect(sent.some((item) => item.data?.action === "publish")).toBe(true);
	expect(regenerate?.disabled).toBe(false);
});

test("failed cover generation retries automatically and succeeds", async () => {
	let attempts = 0;
	const reply = runtime.sendMessage;
	runtime.sendMessage = async (message) => {
		if (
			(message as { type: string }).type === "generateAiImage" &&
			attempts++ === 0
		)
			throw new Error("Temporary provider failure");
		return reply(message);
	};
	await fakeBrowser.storage.local.set({ "storylens-auto-chapter-cover": true });
	syncChapterCover(coverChapter());
	await tick();
	expect(root()?.textContent).toContain("Retrying automatically");
	const details = root()?.querySelector<HTMLDetailsElement>(".error-details");
	expect(details?.hidden).toBe(false);
	expect(details?.open).toBe(false);
	expect(details?.querySelector("summary")?.textContent).toBe("Details");
	expect(details?.querySelector("p")?.textContent).toBe(
		"Temporary provider failure",
	);
	if (details) details.open = true;
	expect(button("Stop")?.hidden).toBe(false);
	await new Promise((resolve) => setTimeout(resolve, 2100));
	expect(attempts).toBe(2);
	expect(details?.hidden).toBe(true);
	expect(details?.open).toBe(false);
	expect(details?.querySelector("p")?.textContent).toBe("");
	expect(hasCover).toBe(true);
	expect(sent.some((item) => item.data?.action === "release")).toBe(true);
});

test("failed cover upload retries the saved image without another AI request", async () => {
	let uploads = 0;
	const reply = runtime.sendMessage;
	runtime.sendMessage = async (message) => {
		if (
			(message as { data?: { action?: string } }).data?.action === "publish" &&
			uploads++ === 0
		) {
			contextRecord = { ...contextRecord, generating: true, context: null };
			throw new Error("Upload failed");
		}
		return reply(message);
	};
	await fakeBrowser.storage.local.set({ "storylens-auto-chapter-cover": true });
	syncChapterCover(coverChapter());
	for (
		let i = 0;
		i < 10 && !root()?.querySelector(".error-details p")?.textContent;
		i++
	)
		await tick();
	expect(root()?.querySelector("img")?.src).toBe("blob:cover-preview");
	expect(root()?.querySelector(".error-details p")?.textContent).toBe(
		"Upload failed",
	);
	await new Promise((resolve) => setTimeout(resolve, 2100));
	expect(uploads).toBe(2);
	expect(sent.filter((item) => item.type === "generateAiImage")).toHaveLength(
		1,
	);
	expect(hasCover).toBe(true);
});

test("Stop cancels a scheduled cover retry", async () => {
	let attempts = 0;
	const reply = runtime.sendMessage;
	runtime.sendMessage = async (message) => {
		if ((message as { type: string }).type === "generateAiImage") {
			attempts++;
			throw new Error("Offline");
		}
		return reply(message);
	};
	await fakeBrowser.storage.local.set({ "storylens-auto-chapter-cover": true });
	syncChapterCover(coverChapter());
	await tick();
	button("Stop")?.click();
	await new Promise((resolve) => setTimeout(resolve, 2100));
	expect(attempts).toBe(1);
	expect(root()?.textContent).toContain("Image generation stopped.");
});

test("cover generation waits for replacement context, then uses the new scene snapshot before claiming", async () => {
	contextRecord.generating = true;
	await fakeBrowser.storage.local.set({ "storylens-auto-chapter-cover": true });
	syncChapterCover(coverChapter());
	await tick();
	expect(root()?.textContent).toContain(
		"Waiting for the current chapter context",
	);
	expect(button("Stop")?.hidden).toBe(false);
	expect(
		sent.some(
			(item) =>
				item.data?.action === "claim" || item.type === "generateAiImage",
		),
	).toBe(false);
	const replacement = readyCoverContext();
	if (!replacement.context) throw new Error("Missing context fixture");
	replacement.context.summary = "The guardian reveals the hidden crown.";
	contextRecord = replacement;
	await new Promise((resolve) => setTimeout(resolve, 1600));
	const prompt = sent.find((item) => item.type === "generateAiImage")?.data
		?.prompt;
	expect(prompt).toContain("The guardian reveals the hidden crown.");
	expect(
		sent.findIndex((item) => item.type === "readChapterContext"),
	).toBeLessThan(sent.findIndex((item) => item.data?.action === "claim"));
	expect(sent.some((item) => item.type === "imageContinuity")).toBe(false);
});

test("missing context waits for reader action and Stop cancels without a cover claim", async () => {
	contextRecord.context = null;
	syncChapterCover(coverChapter());
	await tick();
	startChapterCover();
	await tick();
	expect(root()?.textContent).toContain(
		"Generate the current chapter’s context below",
	);
	expect(
		sent.some(
			(item) =>
				item.data?.action === "claim" || item.type === "generateAiImage",
		),
	).toBe(false);
	button("Stop")?.click();
	contextRecord = readyCoverContext();
	await new Promise((resolve) => setTimeout(resolve, 1600));
	expect(
		sent.some(
			(item) =>
				item.data?.action === "claim" || item.type === "generateAiImage",
		),
	).toBe(false);
	expect(root()?.textContent).toContain("Image generation stopped.");
});

test("disposal ignores a late ready context and never claims or generates", async () => {
	const pending = Promise.withResolvers<unknown>();
	const reply = runtime.sendMessage;
	runtime.sendMessage = (message) =>
		(message as { type: string }).type === "readChapterContext"
			? pending.promise
			: reply(message);
	syncChapterCover(coverChapter());
	await tick();
	startChapterCover();
	await tick();
	clearChapterCover();
	pending.resolve({ res: readyCoverContext() });
	await tick();
	expect(
		sent.some(
			(item) =>
				item.data?.action === "claim" || item.type === "generateAiImage",
		),
	).toBe(false);
	expect(root()).toBeUndefined();
});
