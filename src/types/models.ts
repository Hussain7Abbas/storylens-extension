import type {
	GetKeywordCategories200DataItem,
	GetKeywordNatures200DataItem,
	GetNovels200DataItem,
} from "@/api/generated/schemas";

export type KeywordCategory = GetKeywordCategories200DataItem;
export type KeywordNature = GetKeywordNatures200DataItem;
export type { GetNovels200DataItem as Novel };
