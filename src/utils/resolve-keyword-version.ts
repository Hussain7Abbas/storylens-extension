import type {
	GetKeywords200DataItem,
	GetKeywords200DataItemAliasesItem,
	GetKeywords200DataItemVersionsItem,
} from "@/api/generated/schemas";
import type {
	EnrichedCategory,
	EnrichedKeyword,
	EnrichedNature,
} from "@/types/content-data";

function toDateString(value: unknown): string {
	if (typeof value === "string") return value;
	if (value instanceof Date) return (value as Date).toISOString();
	return String(value);
}

function pickVersion(
	versions: GetKeywords200DataItemVersionsItem[],
	currentChapter: number,
): GetKeywords200DataItemVersionsItem | undefined {
	if (versions.length === 0) return undefined;

	const active = versions.find((v) => {
		const start = Number(v.startingChapter);
		const end = v.endingChapter;
		return (
			start <= currentChapter &&
			(end === null || end === undefined || Number(end) >= currentChapter)
		);
	});
	if (active) return active;

	return [...versions].sort(
		(a, b) => Number(a.startingChapter) - Number(b.startingChapter),
	)[0];
}

/**
 * Resolves a nullable field through the priority chain:
 *   alias (override) → active version → alias (no override) → base version
 * When called without alias args, behaves as: active → base.
 */
function pickField<T>(
	activeVal: T | null | undefined,
	baseVal: T | null | undefined,
	aliasVal?: T | null | undefined,
	override?: boolean,
): T | null {
	if (override && aliasVal != null) return aliasVal;
	if (activeVal != null) return activeVal;
	if (aliasVal != null) return aliasVal;
	return baseVal ?? null;
}

export type ResolvedStyle = {
	category: EnrichedCategory;
	nature: EnrichedNature;
	description: string | null;
	imageId: string | null;
	image: GetKeywords200DataItemVersionsItem["image"];
};

/**
 * Resolves the display style for a keyword or alias entry.
 * Returns null if category or nature cannot be resolved (base version has no style).
 */
export function resolveStyle(
	active: GetKeywords200DataItemVersionsItem | undefined,
	base: GetKeywords200DataItemVersionsItem | undefined,
	alias?: GetKeywords200DataItemAliasesItem | null,
): ResolvedStyle | null {
	const override = alias?.overrideStyle ?? false;

	const category = pickField(
		active?.category as EnrichedCategory | null | undefined,
		base?.category as EnrichedCategory | null | undefined,
		alias?.category as EnrichedCategory | null | undefined,
		override,
	);
	const nature = pickField(
		active?.nature as EnrichedNature | null | undefined,
		base?.nature as EnrichedNature | null | undefined,
		alias?.nature as EnrichedNature | null | undefined,
		override,
	);

	if (!category || !nature) return null;

	const description = pickField(
		active?.description,
		base?.description,
		alias?.description,
		override,
	);

	return {
		category,
		nature,
		description,
		imageId: active?.imageId ?? base?.imageId ?? null,
		image: active?.image ?? base?.image ?? null,
	};
}

/**
 * Converts root keywords (with embedded aliases/versions) into EnrichedKeyword[].
 * Applies the style fallback chain: alias override → active version → alias fallback → base version.
 */
export function enrichKeywords(
	keywords: GetKeywords200DataItem[],
	currentChapter: number,
): EnrichedKeyword[] {
	const enriched: EnrichedKeyword[] = [];

	for (const kw of keywords) {
		const sorted = [...kw.versions].sort(
			(a, b) => Number(a.startingChapter) - Number(b.startingChapter),
		);
		const base = sorted[0];
		const active = pickVersion(kw.versions, currentChapter);

		const kwStyle = resolveStyle(active, base);
		if (!kwStyle) continue;

		enriched.push({
			id: kw.id,
			name: kw.name,
			description: kwStyle.description,
			matchingType: kw.matchingType,
			categoryId: kwStyle.category.id,
			natureId: kwStyle.nature.id,
			imageId: kwStyle.imageId,
			keywordId: null,
			novelId: kw.novelId,
			createdById: kw.createdById ?? null,
			createdAt: toDateString(kw.createdAt),
			updatedAt: toDateString(kw.updatedAt),
			category: kwStyle.category,
			nature: kwStyle.nature,
			image: kwStyle.image,
		});

		for (const alias of kw.aliases) {
			const aliasStyle = resolveStyle(active, base, alias);
			if (!aliasStyle) continue;

			enriched.push({
				id: alias.id,
				name: alias.name,
				description: aliasStyle.description,
				matchingType: alias.matchingType,
				categoryId: aliasStyle.category.id,
				natureId: aliasStyle.nature.id,
				imageId: aliasStyle.imageId,
				keywordId: kw.id,
				novelId: kw.novelId,
				createdById: alias.createdById ?? null,
				createdAt: toDateString(alias.createdAt),
				updatedAt: toDateString(alias.updatedAt),
				category: aliasStyle.category,
				nature: aliasStyle.nature,
				image: aliasStyle.image,
			});
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

export type {
	GetKeywords200DataItemAliasesItem as KeywordAlias,
	GetKeywords200DataItemVersionsItem as KeywordVersion,
};

export function pickBaseVersion(
	versions: GetKeywords200DataItemVersionsItem[],
): GetKeywords200DataItemVersionsItem | undefined {
	if (versions.length === 0) return undefined;
	return [...versions].sort(
		(a, b) => Number(a.startingChapter) - Number(b.startingChapter),
	)[0];
}

export type InfoSource = "keyword" | "version" | "alias";

export type FieldInfo<T> = {
	value: T | null;
	source: InfoSource;
	overrides: { source: "alias" | "keyword" | "version"; value: T | null }[];
};

export type RawImage = GetKeywords200DataItemVersionsItem["image"];

export type ResolvedInfo = {
	name: FieldInfo<string>;
	category: FieldInfo<EnrichedCategory>;
	nature: FieldInfo<EnrichedNature>;
	description: FieldInfo<string>;
	image: FieldInfo<RawImage>;
};

function resolveFieldInfo<T>(
	activeVal: T | null | undefined,
	baseVal: T | null | undefined,
	aliasVal: T | null | undefined,
	override: boolean,
	activeIsBase: boolean,
): FieldInfo<T> {
	type Override = { source: "alias" | "keyword" | "version"; value: T | null };
	const hasDistinctVersion = !activeIsBase && activeVal != null;

	if (override && aliasVal != null) {
		const overrides: Override[] = [];
		if (hasDistinctVersion) overrides.push({ source: "version", value: activeVal ?? null });
		overrides.push({ source: "keyword", value: baseVal ?? null });
		return { value: aliasVal, source: "alias", overrides };
	}
	if (activeVal != null && !activeIsBase) {
		// Always include alias in the chain (even if null) so the full provenance is visible.
		const overrides: Override[] = [
			{ source: "alias", value: aliasVal ?? null },
			{ source: "keyword", value: baseVal ?? null },
		];
		return { value: activeVal, source: "version", overrides };
	}
	if (activeVal != null) {
		return { value: activeVal, source: "keyword", overrides: [] };
	}
	if (aliasVal != null) {
		// In this branch activeVal is always null, so hasDistinctVersion is false — no version entry.
		const overrides: Override[] = [{ source: "keyword", value: baseVal ?? null }];
		return { value: aliasVal, source: "alias", overrides };
	}
	return { value: baseVal ?? null, source: "keyword", overrides: [] };
}

export function resolveKeywordInfo(
	keyword: GetKeywords200DataItem,
	alias: GetKeywords200DataItemAliasesItem | null,
	currentChapter: number,
): ResolvedInfo {
	const base = pickBaseVersion(keyword.versions);
	const active = pickVersion(keyword.versions, currentChapter);
	const activeIsBase = !active || !base || active.id === base.id;
	const override = alias?.overrideStyle ?? false;

	const name: FieldInfo<string> = alias
		? {
				value: alias.name,
				source: "alias",
				overrides: [{ source: "keyword", value: keyword.name }],
			}
		: { value: keyword.name, source: "keyword", overrides: [] };

	const category = resolveFieldInfo<EnrichedCategory>(
		active?.category as EnrichedCategory | null | undefined,
		base?.category as EnrichedCategory | null | undefined,
		alias?.category as EnrichedCategory | null | undefined,
		override,
		activeIsBase,
	);

	const nature = resolveFieldInfo<EnrichedNature>(
		active?.nature as EnrichedNature | null | undefined,
		base?.nature as EnrichedNature | null | undefined,
		alias?.nature as EnrichedNature | null | undefined,
		override,
		activeIsBase,
	);

	const description = resolveFieldInfo<string>(
		active?.description,
		base?.description,
		alias?.description,
		override,
		activeIsBase,
	);

	const image = resolveFieldInfo<RawImage>(
		active?.image as RawImage | null | undefined,
		base?.image as RawImage | null | undefined,
		alias?.image as RawImage | null | undefined,
		override,
		activeIsBase,
	);

	return { name, category, nature, description, image };
}
