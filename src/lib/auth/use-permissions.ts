import { useAtomValue } from "jotai";
import { type AuthUser, currentUserAtom, userAccessAtom } from "./auth-store";

export function useCanMutate(): boolean {
	return useAtomValue(userAccessAtom) !== "guest";
}

/**
 * Whether the user may create keywords (any signed-in reader). Editing and
 * deleting a given row goes through the per-row rules in `permissions.ts`.
 */
export function useCanMutateKeywords(): boolean {
	return useCanMutate();
}

/** Whether the user may create replacements; per-row edits use `permissions.ts`. */
export function useCanMutateReplacements(): boolean {
	return useCanMutate();
}

/** The signed-in user for the per-row rules in `permissions.ts`. */
export function useCurrentUser(): AuthUser | null {
	return useAtomValue(currentUserAtom);
}

export function useIsModerator(): boolean {
	return useAtomValue(userAccessAtom) === "moderator";
}
