/** Languages novel and keyword fields are stored in (`nameAr`/`nameEn`, …). */
export type Language = "ar" | "en";

export const LANGUAGES: Language[] = ["ar", "en"];

/** The extension UI language, mirrored by the popup for background and content scripts. */
export const LOCALE_STORAGE_KEY = "storylens-locale";

type Named = { nameAr?: string | null; nameEn?: string | null };
type Described = {
	descriptionAr?: string | null;
	descriptionEn?: string | null;
};

export function toLanguage(locale: unknown): Language {
	return locale === "ar" ? "ar" : "en";
}

export function nameKey(language: Language): "nameAr" | "nameEn" {
	return language === "ar" ? "nameAr" : "nameEn";
}

export function descriptionKey(
	language: Language,
): "descriptionAr" | "descriptionEn" {
	return language === "ar" ? "descriptionAr" : "descriptionEn";
}

/** The name in `language` only; readers never see the other language's name. */
export function nameIn(item: Named, language: Language): string {
	return item[nameKey(language)] ?? "";
}

export function descriptionIn(item: Described, language: Language): string {
	return item[descriptionKey(language)] ?? "";
}

export function hasNameIn(item: Named, language: Language): boolean {
	return !!item[nameKey(language)]?.trim();
}

/** Keeps only items named in `language`, e.g. local data downloaded in both languages. */
export function namedIn<T extends Named>(items: T[], language: Language): T[] {
	return items.filter((item) => hasNameIn(item, language));
}

/** Request body fields that set `name` in `language` and leave the other language alone. */
export function nameFields(
	language: Language,
	name: string,
): { nameAr: string } | { nameEn: string } {
	return language === "ar" ? { nameAr: name } : { nameEn: name };
}

const ARABIC_LETTER = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/;

/** The language a name is written in, from its script; null when it has no letters. */
export function scriptLanguage(text: string): Language | null {
	if (ARABIC_LETTER.test(text)) return "ar";
	if (LATIN_LETTER.test(text)) return "en";
	return null;
}

type AliasNamed = {
	name: string;
	nameAr?: string | null;
	nameEn?: string | null;
};

/**
 * An alias's name in each language (mirrors the backend's `aliasNames`):
 * `nameAr`/`nameEn` when set, and `name` fills its script's language on
 * aliases saved before they had language names.
 */
export function aliasNames(alias: AliasNamed): Record<Language, string | null> {
	const names: Record<Language, string | null> = {
		ar: alias.nameAr || null,
		en: alias.nameEn || null,
	};
	const language = scriptLanguage(alias.name);
	if (
		language &&
		!names[language] &&
		!Object.values(names).includes(alias.name)
	)
		names[language] = alias.name;
	return names;
}

/** Every distinct name an alias is highlighted by: `name` and its translations. */
export function aliasMatchNames(alias: AliasNamed): string[] {
	const names = aliasNames(alias);
	return [
		...new Set(
			[alias.name, names.ar, names.en].filter(
				(name): name is string => !!name?.trim(),
			),
		),
	];
}

/**
 * Language columns for an alias saved with `name` (mirrors the backend's
 * `aliasNameColumns`), so offline edits match what the server will store.
 */
export function aliasNameColumns(
	name: string,
	previous?: AliasNamed,
): { nameAr: string | null; nameEn: string | null } {
	const names = previous ? aliasNames(previous) : { ar: null, en: null };
	for (const language of LANGUAGES) {
		if (previous && names[language] === previous.name) names[language] = null;
	}
	const language = scriptLanguage(name);
	if (language) names[language] = name;
	return { nameAr: names.ar, nameEn: names.en };
}
