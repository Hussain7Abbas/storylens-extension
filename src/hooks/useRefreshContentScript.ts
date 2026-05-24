import { useCallback } from 'react';
import { refreshContentScript } from '@/utils/refresh-content-script';

export function useRefreshContentScript() {
  return useCallback(async () => {
    return refreshContentScript();
  }, []);
}
