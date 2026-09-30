import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { browser } from "#imports";
import {
	createGuestAccount,
	refreshCurrentUser,
	setupAuthInterceptor,
} from "./auth-service";
import {
	AUTH_STORAGE_KEY,
	getStoredAuth,
	parseStoredAuth,
} from "./auth-storage";
import { authStateAtom, onboardingCompletedAtom } from "./auth-store";

const ONBOARDING_KEY = "storylens-onboarding-completed";

export function useAuthInit() {
	const [, setAuthState] = useAtom(authStateAtom);
	const [, setOnboardingCompleted] = useAtom(onboardingCompletedAtom);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		setupAuthInterceptor();

		void (async () => {
			try {
				const onboardingResult =
					await browser.storage.local.get(ONBOARDING_KEY);
				const completed = onboardingResult[ONBOARDING_KEY] === true;
				setOnboardingCompleted(completed);

				const stored = await getStoredAuth();

				if (stored.user && stored.token) {
					setAuthState({ user: stored.user, token: stored.token });
					void refreshCurrentUser(stored.token);
					return;
				}

				// A session stored in an older shape still has its token: reload the
				// user rather than turning a signed-in reader into a guest.
				if (stored.token) {
					const user = await refreshCurrentUser(stored.token);
					if (user) {
						setAuthState({ user, token: stored.token });
						return;
					}
				}

				const { user, token } = await createGuestAccount();
				setAuthState({ user, token });
			} catch (error) {
				console.error("[StoryLens] Auth init failed:", error);
			} finally {
				setLoading(false);
			}
		})();
	}, [setAuthState, setOnboardingCompleted]);

	// Sign-in, sign-out, and profile edits happen on the website; the bridge
	// content script writes them to storage, so follow those changes here.
	useEffect(() => {
		const handleChange = (
			changes: Record<string, { newValue?: unknown }>,
			area: string,
		) => {
			if (area !== "local" || !(AUTH_STORAGE_KEY in changes)) return;
			setAuthState(parseStoredAuth(changes[AUTH_STORAGE_KEY]?.newValue));
		};
		browser.storage.onChanged.addListener(handleChange);
		return () => browser.storage.onChanged.removeListener(handleChange);
	}, [setAuthState]);

	return { loading };
}
