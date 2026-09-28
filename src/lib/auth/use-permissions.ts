import { useAtomValue } from "jotai";
import { userAccessAtom } from "./auth-store";

export function useCanMutate(): boolean {
	return useAtomValue(userAccessAtom) !== "guest";
}

/** Keywords: readers (own) and moderators. */
export function useCanMutateKeywords(): boolean {
	return useCanMutate();
}

/** Replacements: readers (own) and moderators. */
export function useCanMutateReplacements(): boolean {
	return useCanMutate();
}

export function useIsModerator(): boolean {
	return useAtomValue(userAccessAtom) === "moderator";
}
