import type {
	EnrichedCategory,
	EnrichedNature,
	RawKeyword,
	RawKeywordAlias,
	RawKeywordVersion,
} from "../../src/types/content-data";

const NOW = "2026-01-01T00:00:00.000Z";

export const category: EnrichedCategory = {
	id: "category-1",
	nameEn: "Character",
	nameAr: "شخصية",
	color: "#aa0000",
	description: null,
	createdAt: NOW,
	updatedAt: NOW,
};

export const nature: EnrichedNature = {
	id: "nature-1",
	nameEn: "Ally",
	nameAr: "حليف",
	color: "#00aa00",
	description: null,
	createdAt: NOW,
	updatedAt: NOW,
};

export function image(id: string): NonNullable<RawKeywordVersion["image"]> {
	return {
		id,
		url: `https://images.example.invalid/${id}.png`,
		type: "Image",
		provider_image_id: id,
		delete_url: `https://images.example.invalid/delete/${id}`,
		userId: null,
		createdAt: NOW,
		updatedAt: NOW,
	};
}

export function version(
	values: Partial<RawKeywordVersion> & { id: string },
): RawKeywordVersion {
	return {
		description: null,
		startingChapter: 0,
		endingChapter: null,
		categoryId: null,
		natureId: null,
		imageId: values.image?.id ?? null,
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

export function alias(
	values: Partial<RawKeywordAlias> & { id: string },
): RawKeywordAlias {
	return {
		nameAr: null,
		nameEn: "Alias",
		description: null,
		matchingType: "FULL",
		overrideStyle: false,
		categoryId: null,
		natureId: null,
		imageId: values.image?.id ?? null,
		keywordId: "keyword-1",
		createdById: null,
		createdAt: NOW,
		updatedAt: NOW,
		category: null,
		nature: null,
		image: null,
		...values,
		fuzzyMatchArabicCharacters: values.fuzzyMatchArabicCharacters ?? true,
	};
}

/** A keyword whose base version (chapter 0) carries the category and nature. */
export function keyword(values: Partial<RawKeyword> = {}): RawKeyword {
	return {
		id: "keyword-1",
		nameAr: null,
		nameEn: "Keyword",
		matchingType: "FULL",
		novelId: "novel-1",
		createdById: null,
		createdAt: NOW,
		updatedAt: NOW,
		aliases: [],
		versions: [
			version({
				id: "version-base",
				categoryId: category.id,
				natureId: nature.id,
				category,
				nature,
			}),
		],
		...values,
		fuzzyMatchArabicCharacters: values.fuzzyMatchArabicCharacters ?? true,
	};
}

export function baseVersion(
	values: Partial<RawKeywordVersion> = {},
): RawKeywordVersion {
	return version({
		id: "version-base",
		categoryId: category.id,
		natureId: nature.id,
		category,
		nature,
		...values,
	});
}
