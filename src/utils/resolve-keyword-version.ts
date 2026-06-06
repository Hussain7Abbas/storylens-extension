import type {
	GetKeywords200DataItem,
	GetKeywords200DataItemAliasesItem,
	GetKeywords200DataItemVersionsItem,
} from "@/api/generated/schemas";
import type { EnrichedKeyword } from "@/types/content-data";

function toDateString(value: unknown): string {
	if (typeof value === "string") return value;
	if (value instanceof Date) return (value as Date).toISOString();
	return String(value);
}

/**
 * Finds the version that applies to `currentChapter`.
 * Falls back to the version with the lowest startingChapter.
 */
function pickVersion(
	versions: GetKeywords200DataItemVersionsItem[],
	currentChapter: number,
): GetKeywords200DataItemVersionsItem | undefined {
	if (versions.length === 0) return undefined;

	const active = versions.find((v) => {
		const start = Number(v.startingChapter);
		const end = v.endingChapter;
		return start <= currentChapter && (end === null || end === undefined || Number(end) >= currentChapter);
	});
	if (active) return active;

	return [...versions].sort((a, b) => Number(a.startingChapter) - Number(b.startingChapter))[0];
}

function enrichFromVersion(
	id: string,
	name: string,
	matchingType: "FULL" | "PARTIAL",
	keywordId: string | null,
	novelId: string,
	createdById: string | null,
	createdAt: unknown,
	updatedAt: unknown,
	version: GetKeywords200DataItemVersionsItem,
	descriptionOverride?: string | null,
): EnrichedKeyword {
	return {
		id,
		name,
		description: descriptionOverride !== undefined ? descriptionOverride : (version.description ?? null),
		matchingType,
		categoryId: version.categoryId,
		natureId: version.natureId,
		imageId: version.imageId ?? null,
		keywordId,
		novelId,
		createdById,
		createdAt: toDateString(createdAt),
		updatedAt: toDateString(updatedAt),
		category: version.category,
		nature: version.nature,
		image: version.image,
	};
}

/**
 * Converts root keywords (with embedded aliases/versions) into EnrichedKeyword[].
 * One EnrichedKeyword per root keyword + one per alias.
 */
export function enrichKeywords(
	keywords: GetKeywords200DataItem[],
	currentChapter: number,
): EnrichedKeyword[] {
	const enriched: EnrichedKeyword[] = [];

	for (const kw of keywords) {
		const activeVersion = pickVersion(kw.versions, currentChapter);
		if (!activeVersion) continue;

		enriched.push(
			enrichFromVersion(
				kw.id,
				kw.name,
				kw.matchingType,
				null,
				kw.novelId,
				kw.createdById ?? null,
				kw.createdAt,
				kw.updatedAt,
				activeVersion,
			),
		);

		for (const alias of kw.aliases) {
			enriched.push(
				enrichFromVersion(
					alias.id,
					alias.name,
					alias.matchingType,
					kw.id,
					kw.novelId,
					alias.createdById ?? null,
					alias.createdAt,
					alias.updatedAt,
					activeVersion,
					alias.description ?? null,
				),
			);
		}
	}

	return enriched;
}

/**
 * Returns whether a version is in the future relative to the current chapter.
 */
export function isVersionFuture(
	version: GetKeywords200DataItemVersionsItem,
	currentChapter: number,
): boolean {
	return Number(version.startingChapter) > currentChapter;
}

export type { GetKeywords200DataItemVersionsItem as KeywordVersion };
export type { GetKeywords200DataItemAliasesItem as KeywordAlias };
