import { describe, expect, test } from "bun:test";
import {
	DEFAULT_AI_PROMPTS,
	parseAiPrompts,
} from "../src/lib/desktop-client/ai-prompts";
import {
	buildCharacterImagePrompt,
	chapterMentions,
} from "../src/lib/desktop-client/character-image";
import { buildNovelContextPrompt } from "../src/lib/desktop-client/novel-context-prompt";

describe("parseAiPrompts", () => {
	test("falls back to the defaults for missing or blank prompts", () => {
		expect(parseAiPrompts(undefined)).toEqual(DEFAULT_AI_PROMPTS);
		expect(
			parseAiPrompts({ keywordPrompt: "  ", imagePrompt: "Watercolor." }),
		).toEqual({
			keywordPrompt: DEFAULT_AI_PROMPTS.keywordPrompt,
			imagePrompt: "Watercolor.",
		});
	});
});

describe("chapterMentions", () => {
	test("merges overlapping passages around every name, case-insensitively", () => {
		const text = `${"a".repeat(2000)} Lin smiled at Mira. ${"b".repeat(2000)} LIN left.`;
		const excerpts = chapterMentions(text, ["Lin", "Mira", "x"]);
		expect(excerpts).toHaveLength(2);
		expect(excerpts[0]).toContain("Lin smiled at Mira.");
		expect(excerpts[1]).toContain("LIN left.");
	});

	test("finds a name the chapter writes with diacritics", () => {
		const text = `${"ا ".repeat(1000)}قال مُحَمَّدٌ كلمته.`;
		const excerpts = chapterMentions(text, ["محمد"]);
		expect(excerpts).toHaveLength(1);
		expect(excerpts[0]).toEndWith("قال مُحَمَّدٌ كلمته.");
	});

	test("returns nothing when the chapter does not mention the entity", () => {
		expect(chapterMentions("An empty road.", ["Lin"])).toEqual([]);
	});
});

describe("buildCharacterImagePrompt", () => {
	test("puts the reader instructions before the chapter and novel context", () => {
		const prompt = buildCharacterImagePrompt({
			name: "Lin",
			otherNames: ["Lin", "Young Master"],
			description: "A swordsman.",
			category: "Hero",
			instructions: "Ink wash style.",
			chapterExcerpts: ["Lin wore white robes."],
			novelContext: "Setting: ancient sect",
		});
		expect(prompt).toContain("Entity: Lin / Young Master");
		expect(prompt).toContain("Category: Hero");
		expect(prompt.indexOf("Ink wash style.")).toBeLessThan(
			prompt.indexOf("Lin wore white robes."),
		);
		expect(prompt.indexOf("Lin wore white robes.")).toBeLessThan(
			prompt.indexOf("Setting: ancient sect"),
		);
	});

	test("notes when the chapter has no mentions", () => {
		const prompt = buildCharacterImagePrompt({
			name: "Lin",
			otherNames: [],
			description: "",
			instructions: "x",
			chapterExcerpts: [],
			novelContext: "",
		});
		expect(prompt).toContain("does not mention the entity");
		expect(prompt).not.toContain("<NOVEL_CONTEXT>");
	});
});

describe("novel context research", () => {
	test("asks for a web-researched brief in the reader's language", () => {
		const prompt = buildNovelContextPrompt(
			{
				id: "n",
				name: "Sword & Sect",
				slugs: ["sword-sect"],
				description: "It's long",
			},
			"ar",
		);
		expect(prompt).toContain("Search the web");
		expect(prompt).toContain("sword-sect");
		expect(prompt).toContain("It's long");
		expect(prompt).toContain("Arabic");
	});

	test("uses stored text as typed (the API no longer escapes it)", () => {
		const prompt = buildNovelContextPrompt(
			{ id: "n", name: "D'Artagnan", slugs: [], description: '<b> "x"' },
			"en",
		);
		expect(prompt).toContain(`Reader's description: <b> "x"`);
	});
});
