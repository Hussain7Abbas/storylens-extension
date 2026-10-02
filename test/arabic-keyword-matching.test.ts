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

const { applyContentProcessing } = await import(
	"../src/utils/content-processor"
);
const { destroyKeywordTooltipPortal } = await import(
	"../src/utils/keyword-tooltip"
);

const NOW = "2026-01-01T00:00:00.000Z";
const category = {
	id: "category-1",
	nameAr: "شخصية",
	nameEn: "Character",
	color: "#aa0000",
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
				startingChapter: 0,
				endingChapter: null,
				categoryId: category.id,
				natureId: nature.id,
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
		matchingType: "FULL",
		fuzzyMatchArabicCharacters: true,
		overrideStyle: false,
		categoryId: null,
		natureId: null,
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
