import type {
	GetKeywords200DataItem,
	GetKeywords200DataItemAliasesItem,
	GetKeywords200DataItemVersionsItem,
} from "@/api/generated/schemas";
import { parseKeywordEffect, parseWordVfxColor } from "@/lib/keyword-effects";
import type {
	EnrichedCategory,
	EnrichedKeyword,
	EnrichedNature,
} from "@/types/content-data";
import {
	aliasDisplayName,
	aliasMatchNames,
	keywordDescriptionIn,
	type Language,
	nameIn,
} from "@/utils/translation";

function toDateString(value: unknown): string {
	if (typeof value === "string") return value;
	if (value instanceof Date) return (value as Date).toISOString();
	return String(value);
}

export function pickActiveVersion(
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

/** Whether a row carries an image that can already be shown. */
function hasImage(
	row:
		| GetKeywords200DataItemVersionsItem
		| GetKeywords200DataItemAliasesItem
		| null
		| undefined,
): boolean {
	return !!row?.image?.url;
}

/**
 * The newest version carrying an image, so a keyword whose active and base
 * versions have none still shows one (the latest image wins). `exclude` skips
 * versions already tried earlier in the chain.
 */
export function latestVersionWithImage(
	versions: GetKeywords200DataItemVersionsItem[],
	exclude: (string | undefined)[] = [],
): GetKeywords200DataItemVersionsItem | undefined {
	return [...versions]
		.sort((a, b) => Number(b.startingChapter) - Number(a.startingChapter))
		.find((version) => hasImage(version) && !exclude.includes(version.id));
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
	versions: GetKeywords200DataItemVersionsItem[] = [],
	language: Language = "en",
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
		keywordDescriptionIn(active, language),
		keywordDescriptionIn(base, language),
		keywordDescriptionIn(alias, language),
		override,
	);

	// An alias shows its own image; without one it falls back to its keyword's
	// (the active version, then the latest version that has one, then the base).
	const source =
		(hasImage(alias) ? alias : undefined) ??
		(hasImage(active) ? active : undefined) ??
		latestVersionWithImage(versions, [active?.id]) ??
		(hasImage(base) ? base : undefined);

	return {
		category,
		nature,
		description,
		imageId: source?.imageId ?? null,
		image: source?.image ?? null,
	};
}

/**
 * Converts root keywords (with embedded aliases/versions) into EnrichedKeyword[].
 * Applies the style fallback chain: alias override → active version → alias fallback → base version.
 */
export function enrichKeywords(
	keywords: GetKeywords200DataItem[],
	currentChapter: number,
	language: Language,
): EnrichedKeyword[] {
	const enriched: EnrichedKeyword[] = [];

	for (const kw of keywords) {
		const sorted = [...kw.versions].sort(
			(a, b) => Number(a.startingChapter) - Number(b.startingChapter),
		);
		const base = sorted[0];
		const active = pickActiveVersion(kw.versions, currentChapter);

		const kwStyle = resolveStyle(active, base, null, kw.versions, language);
		if (!kwStyle) continue;

		enriched.push({
			id: kw.id,
			name: nameIn(kw, language),
			description: kwStyle.description,
			matchingType: kw.matchingType,
			fuzzyMatchArabicCharacters: kw.fuzzyMatchArabicCharacters ?? true,
			wordVfx: parseKeywordEffect(kw.wordVfx),
			wordVfxColor: parseWordVfxColor(kw.wordVfxColor),
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
			const aliasStyle = resolveStyle(
				active,
				base,
				alias,
				kw.versions,
				language,
			);
			if (!aliasStyle) continue;

			// One entry per name, so an alias's translation is highlighted too.
			for (const name of aliasMatchNames(alias))
				enriched.push({
					id: alias.id,
					name,
					description: aliasStyle.description,
					matchingType: alias.matchingType,
					fuzzyMatchArabicCharacters: alias.fuzzyMatchArabicCharacters ?? true,
					wordVfx: parseKeywordEffect(alias.wordVfx),
					wordVfxColor: parseWordVfxColor(alias.wordVfxColor),
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
		if (hasDistinctVersion)
			overrides.push({ source: "version", value: activeVal ?? null });
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
		const overrides: Override[] = [
			{ source: "keyword", value: baseVal ?? null },
		];
		return { value: aliasVal, source: "alias", overrides };
	}
	return { value: baseVal ?? null, source: "keyword", overrides: [] };
}

/**
 * Resolves the image shown for a keyword or alias, with the provenance of the
 * ones it replaced. Unlike style fields, an alias's own image always wins (no
 * override needed); without one it falls back to its keyword: the active
 * version, then the latest other version that has an image, then the base
 * version. The last two keep a character in sight whose image was uploaded on
 * a version the reader is not reading.
 */
function resolveImageInfo(
	keyword: GetKeywords200DataItem,
	alias: GetKeywords200DataItemAliasesItem | null,
	active: GetKeywords200DataItemVersionsItem | undefined,
	base: GetKeywords200DataItemVersionsItem | undefined,
	activeIsBase: boolean,
): FieldInfo<RawImage> {
	type Entry = { source: InfoSource; value: RawImage };
	const chain: Entry[] = [];

	// The alias is always listed, so its empty image is visible as provenance.
	if (alias)
		chain.push({
			source: "alias",
			value: (hasImage(alias) ? alias.image : null) as RawImage,
		});
	// The version in effect for this chapter comes first; it is the keyword's
	// own image when that version is the base one.
	const activeImage = (hasImage(active) ? active?.image : null) as RawImage;
	const activeIsKeyword = activeIsBase && activeImage != null;
	if (activeImage != null)
		chain.push({
			source: activeIsBase ? "keyword" : "version",
			value: activeImage,
		});
	const latest = latestVersionWithImage(keyword.versions, [
		active?.id,
		base?.id,
	]);
	if (latest)
		chain.push({ source: "version", value: latest.image as RawImage });
	if (!activeIsKeyword)
		chain.push({
			source: "keyword",
			value: (hasImage(base) ? base?.image : null) as RawImage,
		});

	const chosen = chain.findIndex((entry) => entry.value != null);
	if (chosen === -1) return { value: null, source: "keyword", overrides: [] };
	return {
		value: chain[chosen].value,
		source: chain[chosen].source,
		overrides: chain
			.filter((_, index) => index !== chosen)
			.map((entry) => ({
				source: entry.source as "alias" | "keyword" | "version",
				value: entry.value,
			})),
	};
}

/**
 * The keyword's own resolved image (active version, then the latest version
 * that has one, then the base version). Alias and version rows inherit it when
 * they carry no image of their own, so no row is left blank.
 */
export function resolveKeywordImage(
	keyword: GetKeywords200DataItem,
	currentChapter: number,
): RawImage {
	const base = pickBaseVersion(keyword.versions);
	const active = pickActiveVersion(keyword.versions, currentChapter);
	const activeIsBase = !active || !base || active.id === base.id;
	return resolveImageInfo(keyword, null, active, base, activeIsBase).value;
}

export function resolveKeywordInfo(
	keyword: GetKeywords200DataItem,
	alias: GetKeywords200DataItemAliasesItem | null,
	currentChapter: number,
	language: Language,
): ResolvedInfo {
	const keywordName = nameIn(keyword, language);
	const base = pickBaseVersion(keyword.versions);
	const active = pickActiveVersion(keyword.versions, currentChapter);
	const activeIsBase = !active || !base || active.id === base.id;
	const override = alias?.overrideStyle ?? false;

	const name: FieldInfo<string> = alias
		? {
				value: aliasDisplayName(alias, language),
				source: "alias",
				overrides: [{ source: "keyword", value: keywordName }],
			}
		: { value: keywordName, source: "keyword", overrides: [] };

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
		keywordDescriptionIn(active, language),
		keywordDescriptionIn(base, language),
		keywordDescriptionIn(alias, language),
		override,
		activeIsBase,
	);

	const image = resolveImageInfo(keyword, alias, active, base, activeIsBase);

	return { name, category, nature, description, image };
}

/** Tooltip fields prefer the hovered row, then the original keyword's base values. */
export function resolveTooltipInfo(
	keyword: GetKeywords200DataItem,
	alias: GetKeywords200DataItemAliasesItem | null,
	currentChapter: number,
	language: Language,
): ResolvedInfo {
	const info = resolveKeywordInfo(keyword, alias, currentChapter, language);
	const base = pickBaseVersion(keyword.versions);
	const active = pickActiveVersion(keyword.versions, currentChapter);
	const row = alias ?? active ?? base;
	const source: InfoSource = alias
		? "alias"
		: active?.id !== base?.id
			? "version"
			: "keyword";
	const withOriginal = <T>(
		value: T | null | undefined,
		original: T | null | undefined,
	): FieldInfo<T> => ({
		value: value ?? original ?? null,
		source: value == null ? "keyword" : source,
		overrides: [],
	});
	const image = withOriginal<RawImage>(
		hasImage(row) ? row?.image : null,
		hasImage(base) ? base?.image : null,
	);
	// Preserve image provenance and find an image elsewhere only when both are empty.
	const tooltipImage = image.value
		? {
				...image,
				overrides: [
					{ source: info.image.source, value: info.image.value },
					...info.image.overrides,
				].filter((entry) => entry.value !== image.value),
			}
		: info.image;
	return {
		...info,
		name: alias
			? withOriginal(nameIn(alias, language) || null, nameIn(keyword, language))
			: { ...info.name, overrides: [] },
		description: withOriginal(
			keywordDescriptionIn(row, language),
			keywordDescriptionIn(base, language),
		),
		category: withOriginal(
			row?.category as EnrichedCategory | null | undefined,
			base?.category as EnrichedCategory | null | undefined,
		),
		nature: withOriginal(
			row?.nature as EnrichedNature | null | undefined,
			base?.nature as EnrichedNature | null | undefined,
		),
		image: tooltipImage,
	};
}
