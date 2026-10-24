import { expect, test } from "bun:test";
import { loadContextHistory } from "../src/lib/chapter-context/history";
import { buildContextPrompt } from "../src/lib/chapter-context/prompt";
import type { ContextTracking } from "../src/lib/chapter-context/schema";
import { coverChapter } from "./helpers/chapter-cover";
import { coverContext } from "./helpers/cover-context";

const input = {
	novelId: "novel",
	chapterNumber: 20,
	entityKeys: ["name:mira"],
};

test("normal tracking reads a single previous context and no bulk when elements are already present", async () => {
	let bulk = 0;
	const result = await loadContextHistory(input, {
		tracking: async () => ({
			previous: { chapterNumber: 19, context: coverContext() },
			lastSeen: [
				{
					entityKey: "name:mira",
					name: "Mira",
					keywordId: null,
					lastSeenChapter: 19,
				},
			],
		}),
		bulk: async () => {
			bulk++;
			return [];
		},
	});
	expect(result.chapters.map((chapter) => chapter.chapterNumber)).toEqual([19]);
	expect(bulk).toBe(0);
});

test("newest returning elements are prioritized before the 80-element history cap", async () => {
	const lastSeen: ContextTracking["lastSeen"] = Array.from(
		{ length: 80 },
		(_, index) => ({
			entityKey: `name:older${index}`,
			name: `Older ${index}`,
			keywordId: null,
			lastSeenChapter: 1,
		}),
	);
	lastSeen.push({
		entityKey: "name:shield",
		name: "Shield",
		keywordId: null,
		lastSeenChapter: 19,
	});
	const requests: string[][] = [];
	await loadContextHistory(
		{ ...input, entityKeys: lastSeen.map((row) => row.entityKey) },
		{
			tracking: async () => ({ previous: null, lastSeen }),
			bulk: async ({ entityKeys }) => {
				requests.push(entityKeys);
				return [];
			},
		},
	);
	expect(requests[0]).toHaveLength(80);
	expect(requests[0]?.[0]).toBe("name:shield");
	expect(lastSeen.at(-1)?.entityKey).toBe("name:shield");
});

test("returning registered and unregistered elements are fetched once by deduplicated chapter numbers", async () => {
	const lastSeen: ContextTracking["lastSeen"] = [
		{
			entityKey: "name:mira",
			name: "Mira",
			keywordId: null,
			lastSeenChapter: 2,
		},
		{ entityKey: "name:leo", name: "Leo", keywordId: null, lastSeenChapter: 2 },
		{
			entityKey: "name:محمد",
			name: "محمد",
			keywordId: null,
			lastSeenChapter: 3,
		},
		{
			entityKey: "name:absent",
			name: "Absent",
			keywordId: null,
			lastSeenChapter: 5,
		},
		{
			entityKey: "name:future",
			name: "Future",
			keywordId: null,
			lastSeenChapter: 21,
		},
	];
	const calls: number[][] = [];
	const result = await loadContextHistory(
		{ ...input, text: "Mira and Leo meet مُحَمَّد. Future cannot leak." },
		{
			tracking: async () => ({
				previous: { chapterNumber: 18, context: coverContext() },
				lastSeen,
			}),
			bulk: async ({ chapterNumbers }) => {
				calls.push(chapterNumbers);
				return chapterNumbers.map((chapterNumber) => {
					const context = coverContext();
					const scene = context.scenes[0];
					const mira = scene?.entities[0];
					if (!scene || !mira) throw new Error("Missing fixture");
					scene.entities.push(
						{ ...mira, entityKey: "name:leo", name: "Leo" },
						{ ...mira, entityKey: "name:محمد", name: "محمد" },
					);
					return { chapterNumber, context };
				});
			},
		},
	);
	expect(calls).toEqual([[3, 2]]);
	expect(result.lastMentions.map((entity) => entity.entityKey)).toEqual([
		"name:محمد",
		"name:mira",
		"name:leo",
	]);
	expect(result.chapters).toHaveLength(1);
	expect(JSON.stringify(result)).not.toContain('"chapterNumber":21');
	expect(JSON.stringify(result)).not.toContain("missingChapters");
});

test("absent elements expire at ten chapters while returning elements can still recover", async () => {
	const old = coverContext();
	const result = await loadContextHistory(
		{ ...input, entityKeys: [] },
		{
			tracking: async () => ({
				previous: { chapterNumber: 10, context: old },
				lastSeen: [],
			}),
			bulk: async () => {
				throw new Error("Unexpected bulk");
			},
		},
	);
	expect(result.chapters[0]?.context.scenes[0]?.entities).toEqual([]);
	expect(old.scenes[0]?.entities).toHaveLength(1);
});

test("context prompt is visual-only and rejects future records from all source collections", () => {
	const context = coverContext();
	const prompt = buildContextPrompt(
		coverChapter(),
		"Current scene",
		"[]",
		"Use concise visual details.",
		{
			chapters: [
				{ chapterNumber: 11, context },
				{
					chapterNumber: 13,
					context: { ...context, summary: "FUTURE SPOILER" },
				},
			],
			lastMentions: [
				{
					entityKey: "name:mira",
					name: "Mira",
					chapterNumber: 14,
					context: { ...context, summary: "FUTURE MENTION" },
				},
			],
			persistentState: [
				{
					entityKey: "name:mira",
					chapterNumber: 15,
					field: "injury",
					value: {
						value: "FUTURE FACT",
						sceneId: "bridge",
						evidence: "future",
					},
				},
			],
		},
	);
	expect(prompt).toContain("No biography, dialogue, power rankings");
	expect(prompt).toContain("lastSeenChapter only");
	expect(prompt).toContain("60,000 characters");
	expect(prompt).not.toContain("FUTURE SPOILER");
	expect(prompt).not.toContain("FUTURE MENTION");
	expect(prompt).not.toContain("FUTURE FACT");
	expect(prompt).toContain("Current scene");
	expect(prompt).toContain("Extract every relevant scene");
	expect(prompt).not.toContain("Depict only the selected moment");
});

test("unregistered returning names require complete word boundaries", async () => {
	let bulk = 0;
	await loadContextHistory(
		{ ...input, entityKeys: [], text: "A miracle happens." },
		{
			tracking: async () => ({
				previous: null,
				lastSeen: [
					{
						entityKey: "name:mira",
						name: "Mira",
						keywordId: null,
						lastSeenChapter: 2,
					},
				],
			}),
			bulk: async () => {
				bulk++;
				return [];
			},
		},
	);
	expect(bulk).toBe(0);
});

test("returning elements share one serialized source chapter instead of repeating its environment", () => {
	const context = coverContext();
	const scene = context.scenes[0];
	const mira = scene?.entities[0];
	if (!scene || !mira) throw new Error("Missing fixture");
	const second = structuredClone(context);
	const secondScene = second.scenes[0];
	if (!secondScene) throw new Error("Missing fixture");
	secondScene.entities = [{ ...mira, entityKey: "name:leo", name: "Leo" }];
	const prompt = buildContextPrompt(
		coverChapter(),
		"Mira and Leo cross the bridge.",
		"[]",
		"Visual only",
		{
			chapters: [],
			lastMentions: [
				{ entityKey: "name:mira", name: "Mira", chapterNumber: 2, context },
				{
					entityKey: "name:leo",
					name: "Leo",
					chapterNumber: 2,
					context: second,
				},
			],
			persistentState: [],
		},
	);
	const data = JSON.parse(
		prompt.match(
			/<CHAPTER_CONTINUITY>\n([\s\S]*?)\n<\/CHAPTER_CONTINUITY>/u,
		)?.[1] ?? "{}",
	) as { lastMentions: { scenes: { entities: { name: string }[] }[] }[] };
	expect(data.lastMentions).toHaveLength(1);
	expect(
		data.lastMentions[0]?.scenes[0]?.entities.map(
			(entity: { name: string }) => entity.name,
		),
	).toEqual(["Mira", "Leo"]);
});
