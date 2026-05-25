import type {
	GetKeywords200DataItem,
	GetNovels200DataItem,
	GetReplacements200DataItem,
} from "@/api/schemas";

export type NovelContentData = {
	novel: GetNovels200DataItem;
	chapterNumber: number | undefined;
	keywords: GetKeywords200DataItem[];
	replacements: GetReplacements200DataItem[];
};

export type ContentProcessingStats = {
	replacementsApplied: number;
	keywordsHighlighted: number;
	skipped: boolean;
};
