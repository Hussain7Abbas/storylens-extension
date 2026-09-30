import { sameValue } from "@/lib/offline/rules/merge";
import type {
	AliasRow,
	AssembledKeyword,
	CategoryRow,
	NatureRow,
	ReplacementRow,
	VersionRow,
} from "@/lib/offline/types";

/**
 * Mirrors of the reader API's rules, checked by `enqueue` before anything is
 * written, so a change the server would refuse is refused at once. Codes match
 * the API's (`apps/backend/src/lib/sync/error-codes.ts`); change both together.
 */
export type ValidationCode =
	| "NAME_REQUIRED"
	| "KEYWORD_NAME_TAKEN"
	| "ALIAS_NAME_TAKEN"
	| "LOOKUP_NAME_TAKEN"
	| "REPLACEMENT_EXISTS"
	| "REPLACEMENT_BIDIRECTIONAL"
	| "VERSION_CHAPTER_REQUIRED"
	| "VERSION_NOT_AFTER_LATEST"
	| "VERSION_ONLY_PROTECTED"
	| "VERSION_BASE_PROTECTED"
	| "CATEGORY_IN_USE"
	| "NATURE_IN_USE"
	| "PARENT_NOT_FOUND"
	| "NOT_FOUND";

export type Names = { nameAr?: string | null; nameEn?: string | null };

function clean(value: string | null | undefined): string | null {
	return value?.trim() || null;
}

/** Backend `assertHasName`: an Arabic or English name is required. */
export function checkHasName(names: Names): ValidationCode | null {
	return clean(names.nameAr) || clean(names.nameEn) ? null : "NAME_REQUIRED";
}

function namesTaken(names: Names, others: Names[]): boolean {
	return (["nameAr", "nameEn"] as const).some((field) => {
		const name = clean(names[field]);
		return !!name && others.some((other) => sameValue(other[field], name));
	});
}

/** Backend `assertKeywordNamesFree`: keyword names are unique per novel in each language. */
export function checkKeywordNames(
	names: Names,
	keywords: AssembledKeyword[],
	exceptId?: string,
): ValidationCode | null {
	return (
		checkHasName(names) ??
		(namesTaken(
			names,
			keywords.filter((keyword) => keyword.id !== exceptId),
		)
			? "KEYWORD_NAME_TAKEN"
			: null)
	);
}

/** Backend `assertAliasNamesFree`: alias names are unique per keyword in each language. */
export function checkAliasNames(
	names: Names,
	aliases: AliasRow[],
	exceptId?: string,
): ValidationCode | null {
	return (
		checkHasName(names) ??
		(namesTaken(
			names,
			aliases.filter((alias) => alias.id !== exceptId),
		)
			? "ALIAS_NAME_TAKEN"
			: null)
	);
}

/** Backend lookup routes: category and nature names are unique in each language given. */
export function checkLookupNames(
	names: Names,
	lookups: (CategoryRow | NatureRow)[],
	exceptId?: string,
): ValidationCode | null {
	return (
		checkHasName(names) ??
		(namesTaken(
			names,
			lookups.filter((lookup) => lookup.id !== exceptId),
		)
			? "LOOKUP_NAME_TAKEN"
			: null)
	);
}

/** Backend `validateReplacement`: `from` is unique per novel, and no pair replaces both ways. */
export function checkReplacement(
	values: { from: string; to: string },
	replacements: ReplacementRow[],
	exceptId?: string,
): ValidationCode | null {
	const others = replacements.filter((row) => row.id !== exceptId);
	if (others.some((row) => sameValue(row.from, values.from)))
		return "REPLACEMENT_EXISTS";
	if (
		others.some(
			(row) => sameValue(row.from, values.to) && sameValue(row.to, values.from),
		)
	) {
		return "REPLACEMENT_BIDIRECTIONAL";
	}
	return null;
}

/** The chapter a new version starts at, as the server decides it (backend version POST). */
export function versionStart(
	values: { currentChapter?: number | null; startingChapter?: number | null },
	moderator: boolean,
): number | null {
	if (moderator) return values.startingChapter ?? values.currentChapter ?? 0;
	return values.currentChapter ?? null;
}

/** The open (latest) version the server closes when a new one is added. */
export function latestOpenVersion(
	versions: VersionRow[],
	exceptId?: string,
): VersionRow | undefined {
	return versions
		.filter(
			(version) => version.endingChapter === null && version.id !== exceptId,
		)
		.sort(
			(left, right) =>
				Number(right.startingChapter) - Number(left.startingChapter),
		)[0];
}

/**
 * Backend version POST: readers need their current chapter, and a new version
 * must start after the latest open one.
 */
export function checkVersionCreate(
	values: { currentChapter?: number | null; startingChapter?: number | null },
	versions: VersionRow[],
	moderator: boolean,
): ValidationCode | null {
	const start = versionStart(values, moderator);
	if (start === null) return "VERSION_CHAPTER_REQUIRED";
	const latest = latestOpenVersion(versions);
	if (latest && start <= Number(latest.startingChapter))
		return "VERSION_NOT_AFTER_LATEST";
	return null;
}

/** Backend version DELETE: the only version and the base version (lowest start) are kept. */
export function checkVersionDelete(
	versionId: string,
	versions: VersionRow[],
): ValidationCode | null {
	if (versions.length <= 1) return "VERSION_ONLY_PROTECTED";
	const base = [...versions].sort(
		(left, right) =>
			Number(left.startingChapter) - Number(right.startingChapter),
	)[0];
	if (base?.id === versionId) return "VERSION_BASE_PROTECTED";
	return null;
}

/** Backend lookup DELETE: refused while any version or alias uses the category or nature. */
export function checkLookupDelete(
	kind: "keywordCategory" | "keywordNature",
	lookupId: string,
	usage: { versions: VersionRow[]; aliases: AliasRow[] },
): ValidationCode | null {
	const field = kind === "keywordCategory" ? "categoryId" : "natureId";
	const used =
		usage.versions.some((version) => version[field] === lookupId) ||
		usage.aliases.some((alias) => alias[field] === lookupId);
	if (!used) return null;
	return kind === "keywordCategory" ? "CATEGORY_IN_USE" : "NATURE_IN_USE";
}
