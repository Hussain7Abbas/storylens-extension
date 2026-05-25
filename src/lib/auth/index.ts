export {
	checkUsernameAvailability,
	clearAuth,
	createGuestAccount,
	getStoredAuth,
	loginWithEmail,
	registerAccount,
	setupAuthInterceptor,
	storeAuth,
	updateProfile,
} from "./auth-service";
export type { AuthUser } from "./auth-store";
export {
	authStateAtom,
	authTokenAtom,
	currentUserAtom,
	onboardingCompletedAtom,
	userRoleAtom,
} from "./auth-store";
export { generateGuestUsername } from "./guest-names";
export { useAuthInit } from "./use-auth-init";
export {
	useCanMutate,
	useCanMutateKeywords,
	useCanMutateReplacements,
	useIsAdmin,
} from "./use-permissions";
