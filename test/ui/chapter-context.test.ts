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
const { syncChapterContext, clearChapterContext } = await import(
	"../../src/lib/chapter-context/page"
);
const { AUTO_CHAPTER_CONTEXT_KEY, continuitySection, parseContextOutput } =
	await import("../../src/lib/chapter-context/prompt");
const { withImageContinuity } = await import(
	"../../src/lib/chapter-context/image"
);
const { createContextView } = await import(
	"../../src/lib/chapter-context/view"
);
const { chapterContextSchema } = await import(
	"../../src/lib/chapter-context/schema"
);
const runtime = fakeBrowser.runtime as unknown as {
	sendMessage: (message: unknown) => Promise<unknown>;
};
const original = runtime.sendMessage;
const sent: { type: string; data?: Record<string, unknown> }[] = [];
const context = {
	schemaVersion: 1 as const,
	summary: "Mira retreats to the shrine.",
	scenes: [
		{
			id: "s1",
			title: "The shrine",
			environment: {
				location: "Shrine",
				time: "Night",
				weather: "Rain",
				lighting: "Blue fire",
				details: "",
			},
			entities: [
				{
					entityKey: "name:mira",
					keywordId: null,
					name: "Mira",
					kind: "character" as const,
					appearance: "Silver hair",
					condition: "Shoulder wounded",
					clothing: "Torn cloak",
					equipment: ["Broken sword"],
					pose: "Kneeling",
					emotion: "Afraid",
					relations: [],
					evidence: "Mira knelt in the shrine.",
				},
			],
		},
	],
	stateChanges: [
		{
			entityKey: "name:mira",
			sceneId: "s1",
			field: "injuries.leftShoulder",
			value: "Wounded",
			evidence: "Her shoulder was wounded.",
		},
	],
};
let saved = false;
let savedHash: string | null = null;
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
beforeEach(async () => {
	clearChapterContext();
	resetFakeBrowser();
	sent.length = 0;
	saved = false;
	savedHash = null;
	document.body.innerHTML =
		'<article class="chapter-content">Mira knelt in the shrine.</article>';
	await fakeBrowser.storage.local.set({
		"storylens-ai-source": "desktop",
		"storylens-desktop-client": {
			token: "paired",
			model: "codex",
			effort: "default",
		},
		"storylens-auth": JSON.stringify({
			token: "token",
			user: {
				id: "reader",
				email: "reader@example.invalid",
				username: "reader",
				name: "Reader",
				isGuest: false,
				role: null,
				permissions: [],
			},
		}),
	});
	runtime.sendMessage = async (message) => {
		const item = message as (typeof sent)[number];
		sent.push(item);
		if (item.type === "readChapterContext")
			return {
				res: {
					context: saved ? context : null,
					contentHash: savedHash,
					generating: false,
					inactiveEntities: [],
				},
			};
		if (item.type === "chapterCoverKeywords") return { res: [] };
		if (item.type === "claimChapterContext")
			return { res: { token: "lease", ready: false } };
		if (item.type === "executeAiPrompt")
			return { res: { ok: true, value: JSON.stringify(context) } };
		if (item.type === "publishChapterContext") {
			saved = true;
			return { res: undefined };
		}
		if (item.type === "imageContinuity")
			return {
				res: {
					chapters: [{ chapterNumber: 12, context }],
					lastMentions: [],
					persistentState: [],
				},
			};
		return { res: undefined };
	};
});
afterEach(() => {
	clearChapterContext();
	runtime.sendMessage = original;
});
afterAll(() => {
	if (registeredHere) GlobalRegistrator.unregister();
});
test("opening a chapter reads only its own context and does not run AI by default", async () => {
	syncChapterContext(coverChapter());
	await tick();
	expect(
		sent.filter((item) => item.type === "readChapterContext"),
	).toHaveLength(1);
	expect(
		sent.some(
			(item) =>
				item.type === "imageContinuity" || item.type === "executeAiPrompt",
		),
	).toBe(false);
	expect(document.getElementById("storylens-chapter-context")).toBeNull();
});
test("automatic context publishes structured JSON once without retrieving neighboring chapters", async () => {
	await fakeBrowser.storage.local.set({ [AUTO_CHAPTER_CONTEXT_KEY]: true });
	syncChapterContext(coverChapter());
	for (let i = 0; i < 8 && !saved; i++) await tick();
	expect(saved).toBe(true);
	const request = sent.find((item) => item.type === "executeAiPrompt")?.data;
	expect(request?.feature).toBe("chapter_context");
	expect(request?.prompt).toContain("Mira knelt in the shrine.");
	expect(sent.filter((item) => item.type === "executeAiPrompt")).toHaveLength(
		1,
	);
	expect(sent.some((item) => item.type === "imageContinuity")).toBe(false);
	const body = sent.find((item) => item.type === "publishChapterContext")?.data;
	expect(chapterContextSchema.safeParse(body?.context).success).toBe(true);
	expect(
		sent.find((item) => item.type === "claimChapterContext")?.data
			?.onlyIfMissing,
	).toBe(true);
	expect(body?.contentHash).toMatch(/^[a-f0-9]{64}$/);
	syncChapterContext(coverChapter());
	await tick();
	expect(sent.filter((item) => item.type === "executeAiPrompt")).toHaveLength(
		1,
	);
});
test.each([null, "older-source-hash"])(
	"automatic generation reuses existing context with source hash %s",
	async (hash) => {
		saved = true;
		savedHash = hash;
		await fakeBrowser.storage.local.set({ [AUTO_CHAPTER_CONTEXT_KEY]: true });
		syncChapterContext(coverChapter());
		await tick();
		expect(
			sent.some(
				(item) =>
					item.type === "claimChapterContext" ||
					item.type === "executeAiPrompt",
			),
		).toBe(false);
		expect(document.getElementById("storylens-chapter-context")).not.toBeNull();
	},
);
test("automatic generation applies to each newly opened chapter missing context", async () => {
	await fakeBrowser.storage.local.set({ [AUTO_CHAPTER_CONTEXT_KEY]: true });
	for (const chapterNumber of [12, 13]) {
		saved = false;
		syncChapterContext({ ...coverChapter(), chapterNumber });
		for (let i = 0; i < 8 && !saved; i++) await tick();
		expect(saved).toBe(true);
	}
	expect(
		sent
			.filter((item) => item.type === "publishChapterContext")
			.map((item) => item.data?.chapterNumber),
	).toEqual([12, 13]);
});
test("image preparation is the point at which neighboring contexts are fetched", async () => {
	const prompt = await withImageContinuity({
		novelId: coverChapter().novel.id,
		chapterNumber: 12,
		prompt: "Draw Mira.",
		names: ["Mira"],
	});
	expect(sent.filter((item) => item.type === "imageContinuity")).toHaveLength(
		1,
	);
	expect(prompt).toContain("CHAPTER_CONTINUITY");
	expect(prompt).toContain("Shoulder wounded");
	expect(sent.some((item) => item.type === "executeAiPrompt")).toBe(false);
});
test("context disclosure renders readable sections safely in English and Arabic", () => {
	for (const locale of ["en", "ar"] as const) {
		const view = createContextView(
			locale,
			() => {},
			() => {},
		);
		document.body.append(view.host);
		view.update({
			context: { ...context, summary: "<img src=x onerror=alert(1)>" },
			contentHash: null,
			generating: false,
			inactiveEntities: [
				{
					entityKey: "name:leo",
					keywordId: null,
					name: "Leo",
					lastMentionedChapter: 10,
					missingChapters: 2,
				},
			],
		});
		const root = view.host.shadowRoot;
		expect(root?.querySelector("details")?.open).toBe(false);
		expect(root?.querySelector("summary")?.textContent).toBe(
			locale === "en" ? "Chapter context" : "سياق الفصل",
		);
		expect(root?.textContent).toContain("Blue fire");
		expect(root?.textContent).toContain("Broken sword");
		expect(root?.textContent).toContain("Leo");
		expect(root?.querySelector("img")).toBeNull();
		view.host.remove();
	}
});
test("structured output validates scene relationships and bounded image context preserves complete JSON", () => {
	expect(
		parseContextOutput(`\`\`\`json\n${JSON.stringify(context)}\n\`\`\``),
	).toEqual(context);
	expect(() =>
		parseContextOutput(
			JSON.stringify({
				...context,
				stateChanges: [{ ...context.stateChanges[0], sceneId: "unknown" }],
			}),
		),
	).toThrow();
	const chapters = [10, 11, 12, 13, 14].map((chapterNumber) => ({
		chapterNumber,
		context: { ...context, summary: "Long summary. ".repeat(400) },
	}));
	const prompt = continuitySection(
		{ chapters, lastMentions: [], persistentState: [] },
		12,
		4000,
	);
	expect(prompt.length).toBeLessThanOrEqual(4000);
	const data = prompt.match(
		/<CHAPTER_CONTINUITY>\n([\s\S]*)\n<\/CHAPTER_CONTINUITY>/u,
	)?.[1];
	expect(data).toBeDefined();
	expect(() => JSON.parse(data ?? "")).not.toThrow();
	expect(prompt).toContain("laterChaptersForClarificationOnly");
});

test("Stop releases a context reservation and permits retry while a late AI result is ignored", async () => {
	const pending: ReturnType<typeof Promise.withResolvers<unknown>>[] = [];
	const reply = runtime.sendMessage;
	runtime.sendMessage = async (message) => {
		const item = message as (typeof sent)[number];
		if (item.type === "executeAiPrompt") {
			sent.push(item);
			const job = Promise.withResolvers<unknown>();
			pending.push(job);
			return job.promise;
		}
		return reply(message);
	};
	await fakeBrowser.storage.local.set({ [AUTO_CHAPTER_CONTEXT_KEY]: true });
	syncChapterContext(coverChapter());
	for (let i = 0; i < 10 && !pending.length; i++) await tick();
	expect(pending).toHaveLength(1);
	const root = document.getElementById("storylens-chapter-context")?.shadowRoot;
	const button = (label: string) =>
		[...(root?.querySelectorAll("button") ?? [])].find(
			(node) => node.textContent === label,
		);
	button("Stop")?.click();
	await tick();
	expect(sent.some((item) => item.type === "releaseChapterContext")).toBe(true);
	button("Generate chapter context")?.click();
	for (let i = 0; i < 10 && pending.length < 2; i++) await tick();
	expect(pending).toHaveLength(2);
	pending[0]?.resolve({ res: { ok: true, value: JSON.stringify(context) } });
	await tick();
	expect(saved).toBe(false);
	pending[1]?.resolve({ res: { ok: true, value: JSON.stringify(context) } });
	for (let i = 0; i < 10 && !saved; i++) await tick();
	expect(saved).toBe(true);
	expect(
		sent.filter((item) => item.type === "publishChapterContext"),
	).toHaveLength(1);
});

test("saved context exposes a priced regeneration button and requests replacement", async () => {
	saved = true;
	syncChapterContext(coverChapter());
	await tick();
	const root = document.getElementById("storylens-chapter-context")?.shadowRoot;
	const button = root?.querySelector("button");
	expect(button?.textContent).toBe("Regenerate context");
	expect(button?.hidden).toBe(false);
	button?.click();
	button?.click();
	await tick();
	expect(sent.filter((item) => item.type === "executeAiPrompt")).toHaveLength(
		1,
	);
	expect(
		sent.find((item) => item.type === "claimChapterContext")?.data?.regenerate,
	).toBe(true);
	expect(
		sent.find((item) => item.type === "claimChapterContext")?.data
			?.onlyIfMissing,
	).toBe(false);
});

test("failed context generation retries automatically", async () => {
	let attempts = 0;
	const reply = runtime.sendMessage;
	runtime.sendMessage = async (message) => {
		if (
			(message as { type: string }).type === "executeAiPrompt" &&
			attempts++ === 0
		)
			throw new Error("Temporary failure");
		return reply(message);
	};
	await fakeBrowser.storage.local.set({ [AUTO_CHAPTER_CONTEXT_KEY]: true });
	syncChapterContext(coverChapter());
	await tick();
	expect(
		document.getElementById("storylens-chapter-context")?.shadowRoot
			?.textContent,
	).toContain("Retrying automatically");
	const root = document.getElementById("storylens-chapter-context")?.shadowRoot;
	const details = root?.querySelector<HTMLDetailsElement>(
		".body > .error-details",
	);
	expect(details?.hidden).toBe(false);
	expect(details?.open).toBe(false);
	expect(details?.querySelector("p")?.textContent).toBe("Temporary failure");
	if (details) details.open = true;
	await new Promise((resolve) => setTimeout(resolve, 2100));
	expect(attempts).toBe(2);
	expect(details?.hidden).toBe(true);
	expect(details?.open).toBe(false);
	expect(saved).toBe(true);
	expect(
		document
			.getElementById("storylens-chapter-context")
			?.shadowRoot?.querySelector('[role="status"]')?.textContent,
	).toBe("");
	expect(sent.some((item) => item.type === "releaseChapterContext")).toBe(true);
});

test("context publication retries reuse validated AI output", async () => {
	let publications = 0;
	const reply = runtime.sendMessage;
	runtime.sendMessage = async (message) => {
		if (
			(message as { type: string }).type === "publishChapterContext" &&
			publications++ === 0
		)
			throw new Error("Offline");
		return reply(message);
	};
	await fakeBrowser.storage.local.set({ [AUTO_CHAPTER_CONTEXT_KEY]: true });
	syncChapterContext(coverChapter());
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 2100));
	expect(publications).toBe(2);
	expect(sent.filter((item) => item.type === "executeAiPrompt")).toHaveLength(
		1,
	);
	expect(saved).toBe(true);
});

test("Stop cancels a scheduled context retry and preserves the saved context", async () => {
	saved = true;
	let attempts = 0;
	const reply = runtime.sendMessage;
	runtime.sendMessage = async (message) => {
		if ((message as { type: string }).type === "executeAiPrompt") {
			attempts++;
			throw new Error("Offline");
		}
		return reply(message);
	};
	syncChapterContext(coverChapter());
	await tick();
	const root = document.getElementById("storylens-chapter-context")?.shadowRoot;
	root?.querySelector("button")?.click();
	await tick();
	[...(root?.querySelectorAll("button") ?? [])]
		.find((button) => button.textContent === "Stop")
		?.click();
	await new Promise((resolve) => setTimeout(resolve, 2100));
	expect(attempts).toBe(1);
	expect(root?.textContent).toContain(context.summary);
	expect(root?.querySelector('[role="status"]')?.textContent).toBe("Stopped");
});

test("error details are nested inside context, localized, safe and retained while retrying", () => {
	for (const locale of ["en", "ar"] as const) {
		const view = createContextView(
			locale,
			() => {},
			() => {},
		);
		const root = view.host.shadowRoot;
		const details = root?.querySelector<HTMLDetailsElement>(
			".body > .error-details",
		);
		expect(details?.hidden).toBe(true);
		const message =
			"<img src=x onerror=alert(1)> Provider unavailable\nTry again later.";
		view.retrying(new Error(message));
		expect(details?.querySelector("summary")?.textContent).toBe(
			locale === "ar" ? "التفاصيل" : "Details",
		);
		expect(details?.querySelector("p")?.textContent).toBe(message);
		expect(root?.querySelector("img")).toBeNull();
		expect(details?.open).toBe(false);
		if (details) details.open = true;
		view.working(true);
		view.retrying(new Error("Second failure"));
		expect(details?.open).toBe(true);
		expect(details?.querySelector("p")?.textContent).toBe("Second failure");
		view.stopped();
		expect(details?.hidden).toBe(false);
		view.clearError();
		expect(details?.hidden).toBe(true);
		expect(details?.open).toBe(false);
	}
});
