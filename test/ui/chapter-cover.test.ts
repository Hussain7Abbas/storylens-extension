/// <reference types="bun" />
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { coverChapter } from "../helpers/chapter-cover";
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
	expect(sent.some((item) => item.type === "chapterCoverKeywords")).toBe(true);
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
