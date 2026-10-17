/// <reference types="bun" />
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const registeredHere = !GlobalRegistrator.isRegistered;
if (registeredHere)
	GlobalRegistrator.register({ url: "https://novels.example.invalid/ch/5" });

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import type {
	NovelContentData,
	RawKeyword,
	RawKeywordAlias,
} from "../src/types/content-data";

const { applyContentProcessing, removeExtensionMarkup } = await import(
	"../src/utils/content-processor"
);
const { destroyKeywordTooltipPortal } = await import(
	"../src/utils/keyword-tooltip"
);
const { setWordVfxVisible } = await import("../src/utils/keyword-effects");

const { setPersonalColors, applyLookupColor } = await import(
	"../src/utils/personal-colors"
);

const NOW = "2026-01-01T00:00:00.000Z";
const category = {
	id: "category-1",
	nameAr: "شخصية",
	nameEn: "Character",
	color: "#aa0000",
	effect: "NONE",
	switchPositionWithNature: false,
	wordVfx: "NONE" as const,
	wordVfxColor: null,
	description: null,
	createdAt: NOW,
	updatedAt: NOW,
};
const nature = {
	id: "nature-1",
	nameAr: "حليف",
	nameEn: "Ally",
	color: "#00aa00",
	description: null,
	createdAt: NOW,
	updatedAt: NOW,
};
function keyword(values: Partial<RawKeyword> = {}): RawKeyword {
	return {
		id: "keyword-1",
		nameAr: null,
		nameEn: "Keyword",
		matchingType: "FULL",
		wordVfx: "NONE",
		wordVfxColor: null,
		mainThemeColor: null,
		fuzzyMatchArabicCharacters: true,
		novelId: "novel-1",
		createdById: null,
		createdAt: NOW,
		updatedAt: NOW,
		aliases: [],
		versions: [
			{
				id: "version-base",
				description: null,
				descriptionAr: null,
				descriptionEn: null,
				startingChapter: 0,
				endingChapter: null,
				categoryId: category.id,
				natureId: nature.id,
				imagePrompt: null,
				imageId: null,
				keywordId: "keyword-1",
				createdById: null,
				createdAt: NOW,
				updatedAt: NOW,
				category,
				nature,
				image: null,
			},
		],
		...values,
	};
}
function alias(
	values: Partial<RawKeywordAlias> & { id: string },
): RawKeywordAlias {
	return {
		nameAr: null,
		nameEn: null,
		description: null,
		descriptionAr: null,
		descriptionEn: null,
		matchingType: "FULL",
		wordVfx: "NONE",
		wordVfxColor: null,
		mainThemeColor: null,
		fuzzyMatchArabicCharacters: true,
		overrideStyle: false,
		categoryId: null,
		natureId: null,
		imagePrompt: null,
		imageId: null,
		keywordId: "keyword-1",
		createdById: null,
		createdAt: NOW,
		updatedAt: NOW,
		category: null,
		nature: null,
		image: null,
		...values,
	};
}
const novel: NovelContentData["novel"] = {
	id: "novel-1",
	nameAr: "رواية",
	nameEn: "Novel",
	descriptionAr: null,
	descriptionEn: null,
	context: null,
	slugs: [],
	imageId: null,
	createdById: null,
	createdAt: NOW,
	updatedAt: NOW,
};

function highlight(
	text: string,
	keywords: NovelContentData["keywords"],
	replacements: NovelContentData["replacements"] = [],
) {
	return process(text, keywords, replacements).matches;
}

function replacement(
	from: string,
	to: string,
): NovelContentData["replacements"][number] {
	return {
		id: `replacement-${from}`,
		from,
		to,
		matchingType: "FULL",
		novelId: "novel-1",
		keywordId: null,
		createdById: null,
		createdAt: NOW,
		updatedAt: NOW,
		keyword: null,
	};
}

function process(
	text: string,
	keywords: NovelContentData["keywords"],
	replacements: NovelContentData["replacements"] = [],
) {
	const root = document.createElement("article");
	root.textContent = text;
	document.body.append(root);
	applyContentProcessing(
		root,
		{
			novel,
			language: "ar",
			chapterNumber: 5,
			keywords,
			replacements,
			biases: [],
		},
		"test",
	);
	const matches = [
		...root.querySelectorAll<HTMLElement>(".storylens-keyword"),
	].map((node) => ({
		text: node.textContent,
		id: node.dataset.keywordId,
	}));
	return { matches, text: root.textContent };
}

afterEach(() => {
	setPersonalColors(undefined);
	setWordVfxVisible(false);
	removeExtensionMarkup();
	destroyKeywordTooltipPortal();
	document.body.replaceChildren();
});

afterAll(async () => {
	if (registeredHere) await GlobalRegistrator.unregister();
});

describe("Arabic keyword variant matching", () => {
	it("matches the five alif forms by default without changing visible text", () => {
		const matches = highlight("امل أمل إمل آمل ٱمل", [
			keyword({ nameAr: "أمل" }),
		]);
		expect(matches.map((match) => match.text)).toEqual([
			"امل",
			"أمل",
			"إمل",
			"آمل",
			"ٱمل",
		]);
	});

	it("respects a strict keyword and canonical hamza encoding", () => {
		const matches = highlight("امل أمل أمل إمل آمل", [
			keyword({ nameAr: "أمل", fuzzyMatchArabicCharacters: false }),
		]);
		expect(matches.map((match) => match.text)).toEqual(["أمل", "أمل"]);
	});

	it("uses each alias's option and resolves a strict collision first", () => {
		const matches = highlight("إمل امل", [
			keyword({
				id: "fuzzy",
				nameAr: "أمل",
				aliases: [
					alias({
						id: "strict",
						nameAr: "إمل",
						nameEn: null,
						fuzzyMatchArabicCharacters: false,
					}),
				],
			}),
		]);
		expect(matches).toEqual([
			{ text: "إمل", id: "strict" },
			{ text: "امل", id: "fuzzy" },
		]);
	});

	it("keeps full word boundaries independent from the variant option", () => {
		const full = keyword({ nameAr: "أمل" });
		expect(highlight("مامل امل", [full]).map((match) => match.text)).toEqual([
			"امل",
		]);
		document.body.replaceChildren();
		expect(
			highlight("مامل امل", [{ ...full, matchingType: "PARTIAL" }]).map(
				(match) => match.text,
			),
		).toEqual(["امل", "امل"]);
	});
});

describe("Arabic diacritics (حركات)", () => {
	const texts = (text: string, keywords: NovelContentData["keywords"]) =>
		highlight(text, keywords).map((match) => match.text);

	it("matches by letters and keeps the page's diacritics in the highlight", () => {
		expect(
			texts("قال مُحَمَّدٌ: محمد ومُحمّد هنا", [keyword({ nameAr: "محمد" })]),
		).toEqual(["مُحَمَّدٌ", "محمد", "مُحمّد"]);
	});

	it("matches a name saved with diacritics against plain text", () => {
		expect(texts("محمد", [keyword({ nameAr: "مُحَمَّد" })])).toEqual(["محمد"]);
	});

	it("skips diacritics and tatweel inside the word and on its prefixes", () => {
		const name = [keyword({ nameAr: "ملك" })];
		expect(texts("مـلـك", name)).toEqual(["مـلـك"]);
		expect(texts("الْمَلِكُ المَلِك", name)).toEqual(["مَلِكُ", "مَلِك"]);
		expect(texts("وَمَلِك بِمَلِك", name)).toEqual(["مَلِك", "مَلِك"]);
	});

	it("keeps the prefix text, adding one tatweel after a connecting letter", () => {
		const name = [keyword({ nameAr: "ملك" })];
		expect(process("بِمَلِك", name).text).toBe("بِـمَلِك");
		document.body.replaceChildren();
		expect(process("بـملك", name).text).toBe("بـملك");
		document.body.replaceChildren();
		expect(process("وَمَلِك", name).text).toBe("وَمَلِك");
	});

	it("still respects full words and the strict alif option", () => {
		expect(texts("محمدين مُحَمَّدِين", [keyword({ nameAr: "محمد" })])).toEqual([]);
		document.body.replaceChildren();
		expect(
			texts("أَمَل اَمَل", [
				keyword({ nameAr: "أمل", fuzzyMatchArabicCharacters: false }),
			]),
		).toEqual(["أَمَل"]);
	});

	it("applies replacements whatever diacritics either side has", () => {
		expect(process("وَمُحَمَّدٌ قال", [], [replacement("مُحمد", "أحمد")]).text).toBe(
			"وَأحمد قال",
		);
		document.body.replaceChildren();
		expect(process("الْمَلِك", [], [replacement("ملك", "أمير")]).text).toBe(
			"الْأمير",
		);
	});
});

// Effects decorate the existing colored highlight, including outside an initial range.
describe("word VFX preserve highlighting", () => {
	it("does not spread category or keyword effects to other words or aliases", () => {
		setWordVfxVisible(true);
		const parent = keyword({
			nameEn: "Mira",
			nameAr: "Mira",
			wordVfx: "SPARKLES",
			aliases: [
				alias({ id: "alias-effect", nameEn: "Sword", wordVfx: "HEAT" }),
				alias({ id: "alias-plain", nameEn: "Hero" }),
			],
		});
		const sibling = keyword({ id: "sibling", nameEn: "Leo", nameAr: "Leo" });
		for (const row of [parent, sibling]) {
			const base = row.versions[0];
			if (!base) throw new Error("base missing");
			row.versions[0] = {
				...base,
				category: { ...category, effect: "GLITCHING" },
			};
		}
		process("Mira Sword Hero Leo", [parent, sibling]);
		const words = [
			...document.querySelectorAll<HTMLElement>(".storylens-keyword"),
		];
		expect(
			words.map((word) => [word.textContent, word.dataset.storylensEffect]),
		).toEqual([
			["Mira", "SPARKLES"],
			["Sword", "HEAT"],
			["Hero", undefined],
			["Leo", undefined],
		]);
	});

	for (const effect of ["HEAT", "SPARKLES"] as const) {
		it(`uses ${effect} tint independently and preserves it across visibility and personal color changes`, () => {
			const row = keyword({
				nameAr: "ميرا",
				wordVfx: effect,
				wordVfxColor: "#123456",
			});
			setWordVfxVisible(false);
			process("وصلت ميرا", [row]);
			const anchor = document.querySelector<HTMLElement>(".storylens-keyword");
			if (!anchor) throw new Error("word missing");
			const text = anchor.textContent;
			expect(anchor.style.getPropertyValue("--sl-word-vfx-color")).toBe(
				"#123456",
			);
			expect(anchor.dataset.storylensEffect).toBeUndefined();
			setWordVfxVisible(true);
			expect(anchor.style.color).toBe(category.color);
			expect(anchor.dataset.storylensEffect).toBe(effect);
			anchor.style.color = "#abcdef";
			setWordVfxVisible(false);
			setWordVfxVisible(true);
			expect(anchor.style.getPropertyValue("--sl-word-vfx-color")).toBe(
				"#123456",
			);
			expect(anchor.style.color).toBe("#abcdef");
			expect(anchor.textContent).toBe(text);
		});
	}

	for (const effect of [
		"NONE",
		"SPARKLES",
		"HEAT",
		"SHAKING",
		"GLITCHING",
		"GLARE",
		"FUTURE_EFFECT",
	]) {
		it(`keeps Arabic text, category color and nature indicator with ${effect}`, () => {
			setWordVfxVisible(true);
			const row = keyword({
				nameAr: "سيف الدين",
				nameEn: null,
				wordVfx: effect as RawKeyword["wordVfx"],
			});
			const base = row.versions[0];
			if (!base) throw new Error("base version missing");
			row.versions[0] = {
				...base,
				startingChapter: 12,
				endingChapter: 24,
				category: { ...category, effect },
			};
			const original = "وصل سيف الدين ثم سيف الدين";
			expect(process(original, [row]).text).toBe(original);
			const anchors = [
				...document.querySelectorAll<HTMLElement>(".storylens-keyword"),
			];
			expect(anchors).toHaveLength(2);
			for (const anchor of anchors) {
				expect(anchor.style.color).toBe(category.color);
				expect(anchor.style.getPropertyPriority("color")).toBe("important");
				expect(
					anchor.querySelector(".storylens-nature-indicator"),
				).not.toBeNull();
				expect(anchor.textContent).toBe("سيف الدين");
				expect(anchor.dataset.storylensEffect).toBe(
					effect === "NONE" || effect === "FUTURE_EFFECT" ? undefined : effect,
				);
				const particles = anchor.querySelectorAll(".storylens-effect-particle");
				expect(particles.length).toBe(effect === "SPARKLES" ? 8 : 0);
				for (const particle of particles)
					expect(particle.getAttribute("aria-hidden")).toBe("true");
				expect(anchor.querySelectorAll(".storylens-effect-smoke")).toHaveLength(
					effect === "HEAT" ? 3 : 0,
				);
				expect(
					anchor.querySelectorAll(".storylens-effect-pixels"),
				).toHaveLength(effect === "GLITCHING" ? 1 : 0);
				expect(anchor.querySelectorAll(".storylens-effect-glare")).toHaveLength(
					effect === "GLARE" ? 1 : 0,
				);
			}
			expect(
				document.querySelectorAll("#storylens-keyword-effect-filters").length,
			).toBe(effect === "HEAT" || effect === "GLITCHING" ? 1 : 0);
			removeExtensionMarkup();
			expect(document.querySelector("article")?.textContent).toBe(original);
			expect(
				document.querySelector("#storylens-keyword-effect-filters"),
			).toBeNull();
		});
	}

	it("keeps effects off by default and toggles existing text without rebuilding it", () => {
		const row = keyword({
			nameAr: "سيف الدين",
			nameEn: null,
			wordVfx: "SPARKLES",
		});
		const base = row.versions[0];
		if (!base) throw new Error("base version missing");
		row.versions[0] = {
			...base,
			category: { ...category, effect: "SPARKLES" },
		};
		process("وصل سيف الدين", [row]);
		const anchor = document.querySelector<HTMLElement>(".storylens-keyword");
		if (!anchor) throw new Error("keyword missing");
		const text = [...anchor.childNodes].find((node) => node.nodeType === 3);
		if (!text) throw new Error("keyword text missing");
		expect(anchor.dataset.storylensEffect).toBeUndefined();
		expect(
			anchor.querySelectorAll("[data-storylens-effect-decoration]"),
		).toHaveLength(0);
		setWordVfxVisible(true);
		expect(anchor.dataset.storylensEffect).toBe("SPARKLES");
		expect(anchor.querySelectorAll(".storylens-effect-particle")).toHaveLength(
			8,
		);
		setWordVfxVisible(true);
		expect(anchor.querySelectorAll(".storylens-effect-particle")).toHaveLength(
			8,
		);
		setWordVfxVisible(false);
		expect(anchor.dataset.storylensEffect).toBeUndefined();
		expect(
			anchor.querySelectorAll("[data-storylens-effect-decoration]"),
		).toHaveLength(0);
		expect(document.querySelector(".storylens-keyword")).toBe(anchor);
		expect([...anchor.childNodes]).toContain(text);
		expect(anchor.textContent).toBe("سيف الدين");
	});
});

describe("personal lookup color rendering", () => {
	it("prioritizes personal colors on keywords, aliases and nature markers, then restores the originals in place", () => {
		const row = keyword({
			nameAr: "سيف الدين",
			nameEn: null,
			aliases: [alias({ id: "alias-color", nameAr: "البطل" })],
		});
		setPersonalColors({
			category: { [category.id]: "#123456" },
			nature: { [nature.id]: "#654321" },
		});
		process("سيف الدين والبطل", [row]);
		const anchors = [
			...document.querySelectorAll<HTMLElement>(".storylens-keyword"),
		];
		expect(anchors.length).toBeGreaterThan(0);
		const text = anchors.map((anchor) => anchor.textContent);
		for (const anchor of anchors) {
			expect(anchor.style.color).toBe("#123456");
			expect(
				(anchor.querySelector(".storylens-nature-indicator") as HTMLElement)
					.style.backgroundColor,
			).toBe("#654321");
		}
		setPersonalColors(undefined);
		for (const anchor of anchors) {
			expect(anchor.style.color).toBe(category.color);
			expect(
				(anchor.querySelector(".storylens-nature-indicator") as HTMLElement)
					.style.backgroundColor,
			).toBe(nature.color);
		}
		expect([...document.querySelectorAll(".storylens-keyword")]).toEqual(
			anchors,
		);
		expect(anchors.map((anchor) => anchor.textContent)).toEqual(text);
	});
	it("applies personal colors to tooltip metadata and live changes without replacing Arabic text", () => {
		const node = document.createElement("span");
		node.textContent = "شخصية";
		document.body.append(node);
		applyLookupColor(node, "category", category);
		const text = node.firstChild;
		setPersonalColors({ category: { [category.id]: "#abcdef" }, nature: {} });
		expect(node.style.color).toBe("#abcdef");
		expect(node.firstChild).toBe(text);
		setPersonalColors(undefined);
		expect(node.style.color).toBe(category.color);
	});
});

describe("category and nature positions", () => {
	it("swaps DOM colors, follows personal changes, and leaves explicit word colors first", () => {
		const row = keyword({ nameAr: "سيف", nameEn: null });
		const base = row.versions[0];
		if (!base) throw new Error("base missing");
		row.versions[0] = {
			...base,
			category: { ...category, switchPositionWithNature: true },
		};
		process("سيف", [row]);
		const word = document.querySelector<HTMLElement>(".storylens-keyword");
		const circle = word?.querySelector<HTMLElement>(
			".storylens-nature-indicator",
		);
		if (!word || !circle) throw new Error("highlight missing");
		expect(word.dataset.storylensColorKind).toBe("nature");
		expect(circle.dataset.storylensColorKind).toBe("category");
		setPersonalColors({
			category: { [category.id]: "#112233" },
			nature: { [nature.id]: "#445566" },
		});
		expect(word.style.color).toBe("#445566");
		expect(circle.style.backgroundColor).toBe("#112233");
		const original = word.textContent;
		applyLookupColor(word, "nature", nature, "color", "#abcdef");
		setPersonalColors({
			category: { [category.id]: "#223344" },
			nature: { [nature.id]: "#556677" },
		});
		expect(word.style.color).toBe("#abcdef");
		expect(circle.style.backgroundColor).toBe("#223344");
		expect(word.textContent).toBe(original);
	});
});
