export { authStateAtom, onboardingCompletedAtom, currentUserAtom, authTokenAtom, userRoleAtom } from './auth-store';
export type { AuthUser } from './auth-store';
export { generateGuestUsername } from './guest-names';
export {
  createGuestAccount,
  loginWithEmail,
  registerAccount,
  checkUsernameAvailability,
  setupAuthInterceptor,
  getStoredAuth,
  storeAuth,
  clearAuth,
  updateProfile,
} from './auth-service';
export { useAuthInit } from './use-auth-init';
export { useCanMutate, useCanMutateKeywords, useCanMutateReplacements, useIsAdmin } from './use-permissions';
