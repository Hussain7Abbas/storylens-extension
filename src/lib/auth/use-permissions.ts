import { useAtomValue } from "jotai";
import { userRoleAtom } from "./auth-store";

export function useCanMutate(): boolean {
	const role = useAtomValue(userRoleAtom);
	return role === "user" || role === "admin";
}

/** Keywords: user (own) and admin. */
export function useCanMutateKeywords(): boolean {
	return useCanMutate();
}

/** Replacements: user (own) and admin. */
export function useCanMutateReplacements(): boolean {
	return useCanMutate();
}

export function useIsAdmin(): boolean {
	const role = useAtomValue(userRoleAtom);
	return role === "admin";
}
