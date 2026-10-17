import { describe, expect, test } from "bun:test";
import { resolveWordVfx } from "../src/lib/keyword-effects";
import { enrichKeywords } from "../src/utils/resolve-keyword-version";
import { alias, category, keyword, nature, version } from "./helpers/keywords";

describe("category VFX inheritance", () => {
	test("uses the chapter's resolved category and alias overrides without inheriting parent VFX", () => {
		const baseCategory = {
			...category,
			wordVfx: "SPARKLES" as const,
			wordVfxColor: "#112233",
		};
		const activeCategory = {
			...category,
			id: "category-active",
			wordVfx: "HEAT" as const,
			wordVfxColor: "#445566",
		};
		const raw = keyword({
			versions: [
				version({
					id: "base",
					startingChapter: 0,
					endingChapter: 9,
					category: baseCategory,
					nature,
				}),
				version({
					id: "active",
					startingChapter: 10,
					category: activeCategory,
					nature,
				}),
			],
			aliases: [
				alias({ id: "alias-inherit" }),
				alias({
					id: "alias-category",
					overrideStyle: true,
					category: baseCategory,
				}),
				alias({ id: "alias-own", wordVfx: "GLITCHING" }),
			],
		});
		const early = enrichKeywords([raw], 5, "en");
		expect(early.find((row) => row.id === raw.id)).toMatchObject({
			wordVfx: "SPARKLES",
			wordVfxColor: "#112233",
		});
		const late = enrichKeywords([raw], 12, "en");
		expect(late.find((row) => row.id === raw.id)).toMatchObject({
			wordVfx: "HEAT",
			wordVfxColor: "#445566",
		});
		expect(late.find((row) => row.id === "alias-inherit")).toMatchObject({
			wordVfx: "HEAT",
			wordVfxColor: "#445566",
		});
		expect(late.find((row) => row.id === "alias-category")).toMatchObject({
			wordVfx: "SPARKLES",
			wordVfxColor: "#112233",
		});
		expect(late.find((row) => row.id === "alias-own")).toMatchObject({
			wordVfx: "GLITCHING",
			wordVfxColor: null,
		});
		const own = enrichKeywords([{ ...raw, wordVfx: "SHAKING" }], 12, "en");
		expect(own.find((row) => row.id === raw.id)?.wordVfx).toBe("SHAKING");
		expect(own.find((row) => row.id === "alias-inherit")?.wordVfx).toBe("HEAT");
	});
	test("keeps a word's own tint independent and treats old/invalid category values as None", () => {
		expect(
			resolveWordVfx(
				{ wordVfx: "HEAT", wordVfxColor: null },
				{ wordVfx: "SPARKLES", wordVfxColor: "#112233" },
			),
		).toEqual({ wordVfx: "HEAT", wordVfxColor: null });
		expect(resolveWordVfx({}, {})).toEqual({
			wordVfx: "NONE",
			wordVfxColor: null,
		});
		expect(
			resolveWordVfx({}, { wordVfx: "unknown", wordVfxColor: "bad" }),
		).toEqual({ wordVfx: "NONE", wordVfxColor: null });
	});
});
