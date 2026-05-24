import { useCallback, useEffect, useState } from 'react';
import type { Novel } from '@/types/models';
import { browser } from '#imports';
import { sendMessage } from '../background/messaging';
import type { currentNovelMeta } from '@/types';
import { findNovelBySlug } from '@/utils/novel-matching';

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function getDetectedNovel(
  tabId: number,
): Promise<currentNovelMeta | undefined> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const novel = await sendMessage('getCurrentNovel', undefined, { tabId });
      if (novel) {
        return novel;
      }
    } catch {
      // Content script may still be initializing.
    }

    if (attempt < 2) {
      await sleep(250);
    }
  }

  try {
    return await sendMessage('getCachedTabNovel', tabId);
  } catch {
    return undefined;
  }
}

export function useDetectedNovel(novels: Novel[] | undefined) {
  const [selectedNovel, setSelectedNovel] = useState<Partial<Novel> | undefined>();
  const [currentTabNovel, setCurrentTabNovel] = useState<
    currentNovelMeta | undefined
  >();

  const applyDetectedNovel = useCallback(
    (detectedNovel: currentNovelMeta) => {
      setCurrentTabNovel(detectedNovel);

      if (!novels?.length) {
        return;
      }

      const novel = findNovelBySlug(novels, detectedNovel.novelSlug);
      if (novel) {
        setSelectedNovel(novel);
      }
    },
    [novels],
  );

  useEffect(() => {
    const detectNovel = async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        return;
      }

      const detectedNovel = await getDetectedNovel(tab.id);
      if (detectedNovel) {
        applyDetectedNovel(detectedNovel);
      }
    };

    void detectNovel();
  }, [applyDetectedNovel, novels]);

  return {
    selectedNovel,
    setSelectedNovel,
    currentTabNovel,
  };
}
