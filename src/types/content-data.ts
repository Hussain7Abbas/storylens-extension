import type {
	GetKeywords200DataItem,
	GetKeywords200DataItemCategory,
	GetKeywords200DataItemNature,
	GetNovels200DataItem,
	GetReplacements200DataItem,
} from "@/api/generated/schemas";

export type EnrichedCategory = GetKeywords200DataItemCategory;
export type EnrichedNature = GetKeywords200DataItemNature;
export type EnrichedKeyword = GetKeywords200DataItem;

export type NovelContentData = {
	novel: GetNovels200DataItem;
	chapterNumber: number | undefined;
	keywords: EnrichedKeyword[];
	replacements: GetReplacements200DataItem[];
};

export type ContentProcessingStats = {
	replacementsApplied: number;
	keywordsHighlighted: number;
	skipped: boolean;
};
