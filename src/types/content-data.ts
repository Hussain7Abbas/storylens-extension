import type {
	GetKeywords200DataItem,
	GetKeywords200DataItemAliasesItem,
	GetKeywords200DataItemVersionsItem,
	GetKeywords200DataItemVersionsItemCategory,
	GetKeywords200DataItemVersionsItemImage,
	GetKeywords200DataItemVersionsItemNature,
	GetNovels200DataItem,
	GetReplacements200DataItem,
	GetWebsiteNovelBiases200Item,
} from "@/api/generated/schemas";

export type RawKeyword = GetKeywords200DataItem;
export type RawKeywordAlias = GetKeywords200DataItemAliasesItem;
export type RawKeywordVersion = GetKeywords200DataItemVersionsItem;

export type EnrichedCategory = GetKeywords200DataItemVersionsItemCategory;
export type EnrichedNature = GetKeywords200DataItemVersionsItemNature;

/**
 * A keyword ready for display/highlighting after active version resolution.
 * category and nature are guaranteed non-null; name is guaranteed non-null.
 */
export type EnrichedKeyword = {
	id: string;
	name: string;
	description: string | null;
	matchingType: "FULL" | "PARTIAL";
	categoryId: string;
	natureId: string;
	imageId: string | null;
	keywordId: string | null;
	novelId: string;
	createdById: string | null;
	createdAt: string;
	updatedAt: string;
	category: GetKeywords200DataItemVersionsItemCategory;
	nature: GetKeywords200DataItemVersionsItemNature;
	image: GetKeywords200DataItemVersionsItemImage;
};

export type NovelContentData = {
	novel: GetNovels200DataItem;
	chapterNumber: number | undefined;
	/** Root keywords with embedded aliases/versions from the server or offline cache. */
	keywords: RawKeyword[];
	replacements: GetReplacements200DataItem[];
	biases: GetWebsiteNovelBiases200Item[];
};

export type ContentProcessingStats = {
	replacementsApplied: number;
	keywordsHighlighted: number;
	skipped: boolean;
};
