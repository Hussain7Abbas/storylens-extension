import { beforeEach, expect, test } from "bun:test";

import {
	DEFAULT_AI_PROMPTS,
	SHARED_AI_PROMPTS_KEY,
} from "@/lib/desktop-client/ai-prompts";

import { fakeBrowser, setOnline, setupEngine } from "./helpers/engine";

const { axiosInstance } = await import("@/api/axios-instance");
const { loadSharedAiPrompts } = await import(
	"@/lib/desktop-client/shared-ai-prompts"
);

beforeEach(async () => {
	await setupEngine();
});

test("fetches centrally saved instructions before building a prompt and refreshes after changes", async () => {
	let custom = {
		...DEFAULT_AI_PROMPTS,
		imagePrompt: "Use ink and watercolor.",
	};
	axiosInstance.defaults.adapter = async (config) => ({
		config,
		status: 200,
		statusText: "OK",
		headers: {},
		data: custom,
	});
	expect(await loadSharedAiPrompts()).toEqual(custom);
	custom = {
		...custom,
		keywordPrompt: "Describe their allegiance.",
		chapterContextPrompt: "Capture scene lighting and lasting injuries.",
		pageSummaryPrompt: "Summarize in three bullets.",
	};
	expect(await loadSharedAiPrompts()).toEqual(custom);
	expect(
		(await fakeBrowser.storage.local.get(SHARED_AI_PROMPTS_KEY))[
			SHARED_AI_PROMPTS_KEY
		],
	).toEqual(custom);
});

test("offline generation uses shared cache and ignores legacy reader overrides", async () => {
	await fakeBrowser.storage.local.set({
		"storylens-ai-prompts": { imagePrompt: "Old local override" },
	});
	setOnline(false);
	expect(await loadSharedAiPrompts()).toEqual(DEFAULT_AI_PROMPTS);
	const shared = {
		...DEFAULT_AI_PROMPTS,
		chapterCoverPrompt: "Wide watercolor scene.",
	};
	await fakeBrowser.storage.local.set({ [SHARED_AI_PROMPTS_KEY]: shared });
	expect(await loadSharedAiPrompts()).toEqual(shared);
});

test("unavailable and older APIs preserve the last successful templates", async () => {
	const shared = {
		...DEFAULT_AI_PROMPTS,
		imagePrompt: "Previously fetched shared style.",
	};
	await fakeBrowser.storage.local.set({ [SHARED_AI_PROMPTS_KEY]: shared });
	axiosInstance.defaults.adapter = async () => {
		throw new Error("Not found / offline");
	};
	expect(await loadSharedAiPrompts()).toEqual(shared);
});

test("older three-template snapshots preserve their shared values and default the new fields", async () => {
	setOnline(false);
	await fakeBrowser.storage.local.set({
		[SHARED_AI_PROMPTS_KEY]: {
			keywordPrompt: "Old shared keyword template",
			imagePrompt: "Old shared image template",
			chapterCoverPrompt: "Old shared cover template",
		},
	});
	expect(await loadSharedAiPrompts()).toMatchObject({
		keywordPrompt: "Old shared keyword template",
		chapterContextPrompt: DEFAULT_AI_PROMPTS.chapterContextPrompt,
		pageSummaryPrompt: DEFAULT_AI_PROMPTS.pageSummaryPrompt,
	});
});
