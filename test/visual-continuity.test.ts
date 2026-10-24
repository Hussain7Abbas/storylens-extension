import { expect, test } from "bun:test";
import {
	buildContextPrompt,
	continuitySection,
} from "../src/lib/chapter-context/prompt";
import type {
	ChapterContext,
	ContinuityContext,
} from "../src/lib/chapter-context/schema";
import { coverChapter } from "./helpers/chapter-cover";
import { coverContext } from "./helpers/cover-context";

function source(chapterNumber: number, marker: string) {
	const context = coverContext();
	context.summary = marker;
	const entity = context.scenes[0]?.entities[0];
	if (!entity) throw new Error("Missing fixture element");
	entity.appearance = marker;
	return { chapterNumber, context };
}

function payload(
	history: ContinuityContext,
	budget = 28000,
	purpose: "image" | "context" = "image",
) {
	const result = continuitySection(history, 12, budget, [], purpose);
	expect(result.length).toBeLessThanOrEqual(budget);
	const json = result.match(
		/<CHAPTER_CONTINUITY>\n([\s\S]*?)\n<\/CHAPTER_CONTINUITY>/,
	)?.[1];
	if (!json) throw new Error("Missing bounded history JSON");
	return JSON.parse(json) as {
		currentChapter: {
			summary: string;
			scenes: ChapterContext["scenes"];
		} | null;
		earlierChapters: {
			chapterNumber: number;
			scenes: ChapterContext["scenes"];
		}[];
		lastMentions: { chapterNumber: number }[];
		persistentStateBeforeChapter: ContinuityContext["persistentState"];
	};
}

test("current scene observations retain the budget before large inherited state facts", () => {
	const history: ContinuityContext = {
		chapters: [source(11, "EARLIER_HELMET"), source(12, "CURRENT_CASUAL")],
		lastMentions: [],
		persistentState: Array.from({ length: 20 }, (_, index) => ({
			entityKey: "name:mira",
			chapterNumber: 2,
			field: `equipment.item${index}`,
			value: {
				value: "outdated gear ".repeat(100),
				sceneId: "battle",
				evidence: "Old battle.",
			},
		})),
	};
	const result = payload(history, 3000);
	expect(result.currentChapter?.scenes[0]?.entities[0]?.appearance).toBe(
		"CURRENT_CASUAL",
	);
	expect(result.persistentStateBeforeChapter.length).toBeLessThan(20);
});

test("returning element sources are ordered newest first independently of provider ordering", () => {
	const history: ContinuityContext = {
		chapters: [source(5, "OLDER")],
		lastMentions: [2, 11, 8, 13].map((chapterNumber) => ({
			...source(chapterNumber, `CHAPTER_${chapterNumber}`),
			entityKey: "name:mira",
			name: "Mira",
		})),
		persistentState: [],
	};
	expect(payload(history).lastMentions.map((row) => row.chapterNumber)).toEqual(
		[11, 8, 2],
	);
});

test("the latest earlier scene gets detail priority while retained scenes remain chronological", () => {
	const earlier = source(11, "Battle then dinner");
	const scene = earlier.context.scenes[0];
	if (!scene) throw new Error("Missing fixture scene");
	earlier.context.scenes = [
		{
			...scene,
			id: "battle",
			entities: scene.entities.map((entity) => ({
				...entity,
				appearance: `HELMET_AT_BATTLE${"x".repeat(500)}`,
			})),
		},
		{
			...scene,
			id: "dinner",
			entities: scene.entities.map((entity) => ({
				...entity,
				appearance: "LATEST_CASUAL",
			})),
		},
	];
	const history = {
		chapters: [earlier],
		lastMentions: [],
		persistentState: [],
	};
	const compact = payload(history, 2500).earlierChapters[0];
	expect(
		compact?.scenes
			.flatMap((row) => row.entities)
			.some((entity) => entity.appearance === "LATEST_CASUAL"),
	).toBe(true);
	expect(
		payload(history).earlierChapters[0]?.scenes.map((row) => row.id),
	).toEqual(["battle", "dinner"]);
});

test("regenerating context never treats the old current-chapter snapshot as source history", () => {
	const history = {
		chapters: [source(12, "STALE_CURRENT"), source(11, "LATEST_EARLIER")],
		lastMentions: [],
		persistentState: [],
	};
	const result = payload(history, 28000, "context");
	expect(result.currentChapter).toBeNull();
	expect(JSON.stringify(result)).not.toContain("STALE_CURRENT");
	expect(result.earlierChapters.map((row) => row.chapterNumber)).toEqual([11]);
});

test("an explicit newer clear wins over duplicate older persistent facts", () => {
	const facts = [
		{
			entityKey: "name:mira",
			chapterNumber: 4,
			field: "injury",
			value: { value: "Wounded", sceneId: "s1", evidence: "A wound." },
		},
		{
			entityKey: "name:mira",
			chapterNumber: 11,
			field: "injury",
			value: { value: null, sceneId: "s2", evidence: "Healed." },
		},
	];
	expect(
		payload({ chapters: [], lastMentions: [], persistentState: facts })
			.persistentStateBeforeChapter,
	).toEqual([facts[1]]);
});

test("custom context templates cannot turn temporary gear into permanent element state", () => {
	const custom = "Carry all old gear forever.";
	const prompt = buildContextPrompt(
		coverChapter(),
		"The battle ended. Mira visits an indoor tea room.",
		"[]",
		custom,
	);
	expect(prompt).toContain('"Character" means any keyword/element');
	expect(
		prompt.indexOf("override conflicting template instructions"),
	).toBeGreaterThan(prompt.indexOf(custom));
	expect(prompt).toContain(
		"A helmet worn only for battle must not automatically remain worn",
	);
	expect(prompt).toContain("a chapter boundary alone does not reset equipment");
	expect(prompt).toContain("Unknown is not an explicit null clear");
});
