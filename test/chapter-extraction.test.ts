import { describe, expect, test } from "bun:test";
import {
	isInLanguage,
	languageRule,
} from "../src/lib/desktop-client/ai-language";
import {
	buildChapterExtractionPrompt,
	CHAPTER_TEXT_CHARS,
	parseChapterExtraction,
} from "../src/lib/desktop-client/chapter-extraction";

const categories = [
	{ id: "cat-person", nameEn: "Person", description: "Any person" },
	{ id: "cat-place", nameEn: "Place" },
];
const natures = [{ id: "nat-friend", nameEn: "Friend" }];

describe("buildChapterExtractionPrompt", () => {
	test("lists options, known names, the language rule, and caps the chapter", () => {
		const prompt = buildChapterExtractionPrompt({
			text: `start${"x".repeat(CHAPTER_TEXT_CHARS)}END`,
			categories,
			natures,
			knownNames: ["Lin", " Lin ", "Su Ming", ""],
			language: "ar",
		});
		expect(prompt).toContain("1. Person — Any person");
		expect(prompt).toContain("2. Place\n");
		expect(prompt).toContain("already known: Lin, Su Ming\n");
		expect(prompt).toContain(languageRule("ar"));
		expect(prompt).not.toContain("END");
	});

	test("says none when no names are known", () => {
		const prompt = buildChapterExtractionPrompt({
			text: "t",
			categories,
			natures,
			knownNames: [],
			language: "en",
		});
		expect(prompt).toContain("already known: (none)");
	});
});

describe("parseChapterExtraction", () => {
	test("maps options, drops known, duplicate, and nameless items", () => {
		const output = `Here you go:\n{"items":[
			{"name":" Mira ","description":" A sailor. ","category":1,"nature":1},
			{"name":"mira","description":"dup","category":1,"nature":1},
			{"name":"Lin","description":"known","category":1,"nature":1},
			{"name":"","description":"no name"},
			{"name":"Harbor","description":"A port.","category":"2","nature":7},
			"junk"
		]}`;
		expect(
			parseChapterExtraction(output, categories, natures, ["lin"]),
		).toEqual([
			{
				name: "Mira",
				description: "A sailor.",
				categoryId: "cat-person",
				natureId: "nat-friend",
			},
			{
				name: "Harbor",
				description: "A port.",
				categoryId: "cat-place",
				natureId: undefined,
			},
		]);
	});

	test("accepts an empty list and rejects malformed answers", () => {
		expect(parseChapterExtraction('{"items":[]}', categories, natures)).toEqual(
			[],
		);
		expect(() =>
			parseChapterExtraction("nothing", categories, natures),
		).toThrow();
		expect(() =>
			parseChapterExtraction('{"list":[]}', categories, natures),
		).toThrow();
		expect(() =>
			parseChapterExtraction("{bad}", categories, natures),
		).toThrow();
	});
});

describe("isInLanguage", () => {
	test("compares Arabic and Latin letters", () => {
		expect(isInLanguage(["أخت Su Ming الكبرى"], "ar")).toBe(true);
		expect(isInLanguage(["Elder sister of Su Ming"], "ar")).toBe(false);
		expect(isInLanguage(["Elder sister of Su Ming"], "en")).toBe(true);
		expect(isInLanguage(["أخت سو مينغ"], "en")).toBe(false);
		expect(isInLanguage(["", "123"], "ar")).toBe(true);
	});
});
