import type { currentNovelMeta } from '@/types';
import {
  applyContentProcessing,
  buildProcessKey,
  findContentRoot,
} from '@/utils/content-processor';
import { loadNovelContentData } from '@/utils/load-novel-content-data';

const LOG_PREFIX = '[StoryLens]';
const MAX_CONTENT_ATTEMPTS = 6;
const CONTENT_RETRY_MS = 500;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForContentRoot(): Promise<HTMLElement | undefined> {
  for (let attempt = 0; attempt < MAX_CONTENT_ATTEMPTS; attempt += 1) {
    const root = findContentRoot();
    const textLength = root.textContent?.trim().length ?? 0;

    console.log(`${LOG_PREFIX} Content root check`, {
      attempt: attempt + 1,
      textLength,
    });

    if (textLength > 100) {
      return root;
    }

    if (attempt < MAX_CONTENT_ATTEMPTS - 1) {
      await sleep(CONTENT_RETRY_MS);
    }
  }

  return undefined;
}

export async function processDetectedNovel(
  meta: currentNovelMeta,
  options?: { force?: boolean },
): Promise<void> {
  console.log(`${LOG_PREFIX} Processing detected novel`, meta);

  try {
    const contentData = await loadNovelContentData(meta);
    if (!contentData) {
      return;
    }

    const contentRoot = await waitForContentRoot();
    if (!contentRoot) {
      console.warn(`${LOG_PREFIX} Chapter content was not ready for processing`);
      return;
    }

    applyContentProcessing(
      contentRoot,
      contentData,
      buildProcessKey(meta.novelSlug, meta.chapter),
      { force: options?.force },
    );
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to process detected novel`, error);
  }
}
