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

/** Every distinct name an alias is highlighted by: its Arabic and English names. */
export function aliasMatchNames(alias: Named): string[] {
	return [
		...new Set(
			[alias.nameAr, alias.nameEn].filter(
				(name): name is string => !!name?.trim(),
			),
		),
	];
}

/** A name for display: the UI language's, or the other one when only that is set. */
export function displayNameIn(item: Named, language: Language): string {
	return nameIn(item, language) || item.nameAr || item.nameEn || "";
}

/**
 * An alias's name for display: the UI language's, or its other name when it has
 * only that one (aliases are highlighted by both names, so they stay listed).
 */
export function aliasDisplayName(alias: Named, language: Language): string {
	return displayNameIn(alias, language);
}
