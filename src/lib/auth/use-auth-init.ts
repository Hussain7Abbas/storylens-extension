import { useAtom } from 'jotai';
import { useEffect, useState } from 'react';
import { browser } from '#imports';
import { authStateAtom, onboardingCompletedAtom } from './auth-store';
import {
  createGuestAccount,
  getStoredAuth,
  setupAuthInterceptor,
} from './auth-service';

const ONBOARDING_KEY = 'storylens-onboarding-completed';

export function useAuthInit() {
  const [, setAuthState] = useAtom(authStateAtom);
  const [, setOnboardingCompleted] = useAtom(onboardingCompletedAtom);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setupAuthInterceptor();

    void (async () => {
      try {
        const onboardingResult = await browser.storage.local.get(ONBOARDING_KEY);
        const completed = onboardingResult[ONBOARDING_KEY] === true;
        setOnboardingCompleted(completed);

        const stored = await getStoredAuth();

        if (stored.user && stored.token) {
          setAuthState({ user: stored.user, token: stored.token });
          return;
        }

        const { user, token } = await createGuestAccount();
        setAuthState({ user, token });
      } catch (error) {
        console.error('[StoryLens] Auth init failed:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, [setAuthState, setOnboardingCompleted]);

  return { loading };
}
