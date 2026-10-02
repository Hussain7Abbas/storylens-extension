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
			instructions: "Describe briefly.",
			novelContext: "Genre: wuxia",
		});
		expect(prompt).toContain("<INSTRUCTIONS>\nDescribe briefly.");
		expect(prompt).toContain("<NOVEL_CONTEXT>\nGenre: wuxia");
		expect(prompt).toContain("1. Person — Any person");
		expect(prompt).toContain("2. Place\n");
		expect(prompt).toContain("already known: Lin, Su Ming\n");
		expect(prompt).toContain('"relation": "alias" | "version" | null');
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
			instructions: "x",
			novelContext: "",
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

	test("shows names without diacritics and compares them by letters", () => {
		const output = `{"items":[
			{"name":"مُحَمَّد","description":"known","category":1,"nature":1},
			{"name":"سَيْف","description":"new","category":1,"nature":1},
			{"name":"سيف","description":"dup","category":1,"nature":1},
			{"name":"الفارس","description":"title","category":1,"nature":1,"parent":"مُحمّد","relation":"alias"}
		]}`;
		const items = parseChapterExtraction(output, categories, natures, ["محمد"]);
		expect(items.map((item) => [item.name, item.suggestedParent])).toEqual([
			["سيف", undefined],
			["الفارس", { name: "محمد", relation: "alias" }],
		]);
	});

	test("keeps a suggested parent only when it names a known or listed entity", () => {
		const output = `{"items":[
			{"name":"Young Master Lin","description":"Lin's title.","category":1,"nature":1,"parent":" lin ","relation":"alias"},
			{"name":"Demon Mira","description":"Mira reborn.","category":1,"nature":1,"parent":"mira","relation":"version"},
			{"name":"Mira","description":"A sailor.","category":1,"nature":1,"parent":null,"relation":null},
			{"name":"Ghost","description":"x","category":1,"nature":1,"parent":"Nobody","relation":"alias"},
			{"name":"Echo","description":"x","category":1,"nature":1,"parent":"Mira","relation":"friend"},
			{"name":"Self","description":"x","category":1,"nature":1,"parent":"self","relation":"alias"}
		]}`;
		const items = parseChapterExtraction(output, categories, natures, ["Lin"]);
		expect(items.map((item) => [item.name, item.suggestedParent])).toEqual([
			["Young Master Lin", { name: "Lin", relation: "alias" }],
			["Demon Mira", { name: "Mira", relation: "version" }],
			["Mira", undefined],
			["Ghost", undefined],
			["Echo", undefined],
			["Self", undefined],
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
