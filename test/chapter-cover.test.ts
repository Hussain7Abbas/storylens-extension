import { expect, test } from "bun:test";
import { featureAiSource } from "../src/lib/ai-source/source";
import {
	buildChapterCoverPrompt,
	chapterCoverReferences,
} from "../src/lib/chapter-cover/prompt";
import {
	DEFAULT_AI_PROMPTS,
	parseAiPrompts,
} from "../src/lib/desktop-client/ai-prompts";
import { coverChapter } from "./helpers/chapter-cover";
import { alias, baseVersion, keyword } from "./helpers/keywords";

test("existing installs receive the cinematic prompt without changing custom character instructions", () => {
	const parsed = parseAiPrompts({ imagePrompt: "Oil portrait" });
	expect(parsed.imagePrompt).toBe("Oil portrait");
	expect(parsed.chapterCoverPrompt).toBe(DEFAULT_AI_PROMPTS.chapterCoverPrompt);
	expect(parsed.chapterCoverPrompt).toContain("most iconic");
	expect(parsed.chapterCoverPrompt).toContain("merge");
	expect(parsed.chapterCoverPrompt).toContain("reference image URLs");
	expect(parsed.chapterCoverPrompt).toContain("landscape chapter cover (16:9)");
});
test("the original portrait seed upgrades to landscape while custom cover prompts remain intact", () => {
	const originalSeed = DEFAULT_AI_PROMPTS.chapterCoverPrompt.replace(
		"a wide landscape chapter cover (16:9)",
		"a portrait book cover (2:3)",
	);
	expect(
		parseAiPrompts({ chapterCoverPrompt: originalSeed }).chapterCoverPrompt,
	).toBe(DEFAULT_AI_PROMPTS.chapterCoverPrompt);
	expect(
		parseAiPrompts({ chapterCoverPrompt: "My painted scene" })
			.chapterCoverPrompt,
	).toBe("My painted scene");
});
test("only actual chapter names and aliases supply their active descriptions and images", () => {
	const data = coverChapter();
	const rows = chapterCoverReferences(
		data,
		"Mira and the Guardian crossed the bridge. A miracle followed.",
	);
	expect(rows.map((row) => row.name)).toEqual(["Mira", "Guardian"]);
	expect(rows[0]?.description).toBe("Wears silver armor.");
	expect(rows[0]?.imageUrl).toContain("armored-mira");
	expect(rows[1]?.description).toBe("A masked guardian.");
	expect(rows[1]?.imageUrl).toContain("guardian");
	expect(chapterCoverReferences(data, "Miracle alone.")).toEqual([]);
});
test("Arabic diacritics still match and aliases keep their own reference without style override", () => {
	const data = {
		...coverChapter(),
		language: "ar" as const,
		keywords: [
			keyword({
				nameAr: "محمد",
				versions: [baseVersion({ descriptionAr: "حارس." })],
				aliases: [
					alias({
						id: "a",
						nameAr: "الحارس",
						nameEn: null,
						descriptionAr: "مقنع.",
					}),
				],
			}),
		],
	};
	expect(
		chapterCoverReferences(data, "مُحَمَّدٌ هو الْحَارِسُ").map(
			(row) => row.description,
		),
	).toEqual(["حارس.", "مقنع."]);
});
test("prompt puts editable instructions first and carries chapter, novel, and keyword reference URLs", () => {
	const result = buildChapterCoverPrompt(
		coverChapter(),
		"Mira raises her sword.",
		"Watercolor cinematic scene.",
	);
	expect(result.prompt.indexOf("Watercolor cinematic scene.")).toBeLessThan(
		result.prompt.indexOf("Fantasy city"),
	);
	expect(result.prompt).toContain("Mira raises her sword.");
	expect(result.prompt).toContain("Wears silver armor.");
	expect(result.prompt).toContain("armored-mira.png");
	expect(result.prompt).not.toContain("Must not appear.");
	expect(result.referenceImageUrls).toHaveLength(1);
});
test("chapter covers follow the image provider independently of text", () => {
	expect(
		featureAiSource("chapter_cover", "cloud", "desktop", {
			token: "paired",
			model: "",
			effort: "",
			port: 43127,
		}),
	).toBe("desktop");
});

test("Arabic full words include marks in their boundaries and respect alif matching preferences", () => {
	const data = {
		...coverChapter(),
		language: "ar" as const,
		keywords: [keyword({ nameAr: "أمل", fuzzyMatchArabicCharacters: true })],
	};
	expect(chapterCoverReferences(data, "اَمَل")).toHaveLength(1);
	expect(chapterCoverReferences(data, "أملُهم")).toHaveLength(0);
	data.keywords[0]!.fuzzyMatchArabicCharacters = false;
	expect(chapterCoverReferences(data, "امل")).toHaveLength(0);
});
