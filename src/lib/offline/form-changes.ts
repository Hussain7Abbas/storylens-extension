import { sameValue } from "@/lib/offline/rules/merge";
import { type Language, nameKey } from "@/utils/translation";

type Row = Record<string, unknown>;

/** A form's change set: only the changed fields, and the values the form started with. */
export type FormChanges<T extends Row = Row> = {
	changes: Partial<T>;
	seen: Partial<T>;
};

/** Empty optional text is `null`, so clearing a field clears it on the server (W5). */
function optionalText(value: string | null | undefined): string | null {
	return value?.trim() ? value.trim() : null;
}

function diff<T extends Row>(
	initial: Partial<T>,
	values: Partial<T>,
): FormChanges<T> | undefined {
	const changes: Row = {};
	const seen: Row = {};
	for (const [field, value] of Object.entries(values)) {
		if (value === undefined) continue;
		if (sameValue(value, initial[field])) continue;
		changes[field] = value;
		seen[field] = initial[field] ?? null;
	}
	return Object.keys(changes).length
		? { changes: changes as Partial<T>, seen: seen as Partial<T> }
		: undefined;
}

export type KeywordFormFields = {
	name: string;
	matchingType: "FULL" | "PARTIAL";
	fuzzyMatchArabicCharacters: boolean;
	categoryId: string;
	natureId: string;
	description: string | null;
	imageId?: string | null;
};

/**
 * The keyword form edits the keyword (name in the UI language, matching) and
 * its base version (description, category, nature, image). Each side gets a
 * change only when one of its fields changed (W4).
 */
export function keywordFormChanges(
	initial: KeywordFormFields,
	values: KeywordFormFields,
	language: Language,
): { keyword?: FormChanges; baseVersion?: FormChanges } {
	const name = nameKey(language);
	return {
		keyword: diff(
			{
				[name]: initial.name.trim(),
				matchingType: initial.matchingType,
				fuzzyMatchArabicCharacters: initial.fuzzyMatchArabicCharacters,
			},
			{
				[name]: values.name.trim(),
				matchingType: values.matchingType,
				fuzzyMatchArabicCharacters: values.fuzzyMatchArabicCharacters,
			},
		),
		baseVersion: diff(
			{
				description: optionalText(initial.description),
				categoryId: initial.categoryId,
				natureId: initial.natureId,
				imageId: initial.imageId ?? null,
			},
			{
				description: optionalText(values.description),
				categoryId: values.categoryId,
				natureId: values.natureId,
				imageId:
					values.imageId === undefined ? undefined : (values.imageId ?? null),
			},
		),
	};
}

export type AliasFormFields = {
	name: string;
	matchingType: "FULL" | "PARTIAL";
	fuzzyMatchArabicCharacters: boolean;
	overrideStyle: boolean;
	categoryId: string | null;
	natureId: string | null;
	description: string | null;
	imageId?: string | null;
};

/** Alias forms edit the UI language's name (`nameAr`/`nameEn`), like keyword forms. */
export function aliasFormChanges(
	initial: AliasFormFields,
	values: AliasFormFields,
	language: Language,
): FormChanges | undefined {
	const name = nameKey(language);
	const shape = (fields: AliasFormFields) => ({
		[name]: fields.name.trim() || null,
		matchingType: fields.matchingType,
		fuzzyMatchArabicCharacters: fields.fuzzyMatchArabicCharacters,
		overrideStyle: fields.overrideStyle,
		categoryId: fields.categoryId || null,
		natureId: fields.natureId || null,
		description: optionalText(fields.description),
		...(fields.imageId === undefined
			? {}
			: { imageId: fields.imageId ?? null }),
	});
	return diff(shape(initial), shape(values));
}

export type VersionFormFields = {
	categoryId: string | null;
	natureId: string | null;
	description: string | null;
	imageId?: string | null;
	startingChapter?: number | null;
	endingChapter?: number | null;
};

export function versionFormChanges(
	initial: VersionFormFields,
	values: VersionFormFields,
): FormChanges | undefined {
	const shape = (fields: VersionFormFields) => ({
		categoryId: fields.categoryId || undefined,
		natureId: fields.natureId || undefined,
		description: optionalText(fields.description),
		...(fields.imageId === undefined
			? {}
			: { imageId: fields.imageId ?? null }),
		...(fields.startingChapter === undefined
			? {}
			: { startingChapter: fields.startingChapter }),
		...(fields.endingChapter === undefined
			? {}
			: { endingChapter: fields.endingChapter }),
	});
	return diff(shape(initial), shape(values));
}

export type ReplacementFormFields = {
	from: string;
	to: string;
	matchingType: "FULL" | "PARTIAL";
};

export function replacementFormChanges(
	initial: ReplacementFormFields,
	values: ReplacementFormFields,
): FormChanges | undefined {
	const shape = (fields: ReplacementFormFields) => ({
		from: fields.from.trim(),
		to: fields.to.trim(),
		matchingType: fields.matchingType,
	});
	return diff(shape(initial), shape(values));
}

export type LookupFormFields = {
	nameAr?: string | null;
	nameEn?: string | null;
	color: string;
	description?: string | null;
};

export function lookupFormChanges(
	initial: LookupFormFields,
	values: LookupFormFields,
): FormChanges | undefined {
	const shape = (fields: LookupFormFields) => ({
		nameAr: optionalText(fields.nameAr),
		nameEn: optionalText(fields.nameEn),
		color: fields.color,
		description: optionalText(fields.description),
	});
	return diff(shape(initial), shape(values));
}
