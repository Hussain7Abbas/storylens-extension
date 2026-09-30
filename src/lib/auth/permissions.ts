import { type AuthUser, MODERATE_PERMISSION } from "./auth-store";

/**
 * Per-row edit rules, mirroring the reader API. The popup gates actions with
 * them and `enqueue` refuses changes they reject, so an offline edit never
 * waits for a 403 at sync. The API still enforces every rule.
 */
type Actor = Pick<AuthUser, "id" | "isGuest" | "permissions"> | null;
type Owned = { createdById?: string | null };

function isSignedInReader(user: Actor): user is NonNullable<Actor> {
	return !!user && !user.isGuest;
}

/** Holds `user:moderate` (backend `canModerate`). */
export function isModerator(user: Actor): boolean {
	return (
		isSignedInReader(user) && user.permissions.includes(MODERATE_PERMISSION)
	);
}

function owns(
	user: NonNullable<Actor>,
	row: Owned | null | undefined,
): boolean {
	return !!row?.createdById && row.createdById === user.id;
}

/** Keywords: a moderator or the keyword's creator (backend `keywords.ts` PUT/DELETE, `assertOwnsResource`). */
export function canEditKeyword(user: Actor, keyword: Owned): boolean {
	return isSignedInReader(user) && (isModerator(user) || owns(user, keyword));
}

export const canDeleteKeyword = canEditKeyword;

/** Any signed-in reader may add a keyword, alias or version (backend POST routes default to readers). */
export function canCreate(user: Actor): boolean {
	return isSignedInReader(user);
}

export const canCreateAlias = canCreate;
export const canCreateVersion = canCreate;

/**
 * Aliases and versions: a moderator, the row's own creator, or the parent
 * keyword's creator (decision D12; backend `assertOwnsAnyOf` in
 * `keyword-aliases.ts` and `keyword-versions.ts` PUT/DELETE).
 */
export function canEditKeywordChild(
	user: Actor,
	row: Owned,
	parentKeyword: Owned | null | undefined,
): boolean {
	return (
		isSignedInReader(user) &&
		(isModerator(user) || owns(user, row) || owns(user, parentKeyword))
	);
}

export const canEditAlias = canEditKeywordChild;
export const canDeleteAlias = canEditKeywordChild;
export const canEditVersion = canEditKeywordChild;
export const canDeleteVersion = canEditKeywordChild;

/** Replacements: a moderator or the replacement's creator (backend `replacements.ts` PUT/DELETE). */
export function canEditReplacement(user: Actor, replacement: Owned): boolean {
	return (
		isSignedInReader(user) && (isModerator(user) || owns(user, replacement))
	);
}

export const canDeleteReplacement = canEditReplacement;

/** Categories and natures are moderator-only (backend `MODERATOR_ENDPOINTS`). */
export function canManageLookups(user: Actor): boolean {
	return isModerator(user);
}

/** Only moderators set a version's chapter range; readers start at their current chapter. */
export function canSetVersionRange(user: Actor): boolean {
	return isModerator(user);
}
