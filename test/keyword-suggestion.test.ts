import { describe, expect, test } from "bun:test";
import {
	buildKeywordSuggestionPrompt,
	decodeKeywordContext,
	encodeKeywordContext,
	KEYWORD_CONTEXT_CHARS,
	parseKeywordSuggestion,
	relatedSuggestionDescription,
} from "../src/lib/desktop-client/keyword-suggestion";

const categories = [
	{
		id: "cat-female",
		nameEn: "Female",
		nameAr: "انثى",
		description: "A woman",
	},
	{ id: "cat-place", nameEn: "مكان", nameAr: "مكان", description: null },
];
const natures = [{ id: "nat-friend", nameEn: "Friend", nameAr: "صديق" }];

describe("keyword context", () => {
	test("round-trips and trims each side to the context limit", () => {
		const long = "x".repeat(KEYWORD_CONTEXT_CHARS + 50);
		const decoded = decodeKeywordContext(
			encodeKeywordContext({ before: `start${long}`, after: `${long}end` }),
		);
		expect(decoded?.before.length).toBe(KEYWORD_CONTEXT_CHARS);
		expect(decoded?.after.length).toBe(KEYWORD_CONTEXT_CHARS);
		expect(decoded?.before.endsWith("x")).toBe(true);
		expect(decoded?.after.startsWith("x")).toBe(true);
	});

	test("rejects missing or malformed values", () => {
		expect(decodeKeywordContext(null)).toBeUndefined();
		expect(decodeKeywordContext("{")).toBeUndefined();
		expect(decodeKeywordContext('{"before":1,"after":""}')).toBeUndefined();
	});
});

describe("buildKeywordSuggestionPrompt", () => {
	test("numbers options, dedupes names, and marks the picked text", () => {
		const prompt = buildKeywordSuggestionPrompt({
			name: " Lin ",
			context: { before: "Then ", after: " smiled." },
			categories,
			natures,
			language: "ar",
		});
		expect(prompt).toContain("Write every description in Arabic");
		expect(prompt).toContain("1. Female / انثى — A woman");
		expect(prompt).toContain("2. مكان\n");
		expect(prompt).toContain("1. Friend / صديق");
		expect(prompt).toContain("Then <<<Lin>>> smiled.");
	});
});

describe("parseKeywordSuggestion", () => {
	test("maps 1-based numbers to ids, including inside fences", () => {
		const output =
			'```json\n{"description":" Her sister. ","category":1,"nature":"1"}\n```';
		expect(parseKeywordSuggestion(output, categories, natures)).toEqual({
			description: "Her sister.",
			categoryId: "cat-female",
			natureId: "nat-friend",
		});
	});

	test("drops out-of-range or non-integer choices", () => {
		const result = parseKeywordSuggestion(
			'{"description":"A town","category":3,"nature":0.5}',
			categories,
			natures,
		);
		expect(result).toEqual({
			description: "A town",
			categoryId: undefined,
			natureId: undefined,
		});
	});

	test("throws when there is no JSON object", () => {
		expect(() =>
			parseKeywordSuggestion("no idea", categories, natures),
		).toThrow();
		expect(() =>
			parseKeywordSuggestion("{oops}", categories, natures),
		).toThrow();
	});
});

describe("relatedSuggestionDescription", () => {
	const suggestion = { description: "Her sister." };
	test("notes the parent for aliases and versions in each language", () => {
		expect(
			relatedSuggestionDescription(
				suggestion,
				{ kind: "alias", name: "Mei", parent: "Lin" },
				"en",
			),
		).toBe("Another name for Lin. Her sister.");
		expect(
			relatedSuggestionDescription(
				suggestion,
				{ kind: "version", name: "Mei", parent: "Lin" },
				"en",
			),
		).toBe("A later form of Lin, known as “Mei”. Her sister.");
		expect(
			relatedSuggestionDescription(
				{ description: "" },
				{ kind: "alias", name: "مي", parent: "لين" },
				"ar",
			),
		).toBe("اسم آخر للشخصية «لين».");
	});
});
