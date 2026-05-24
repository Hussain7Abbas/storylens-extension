import type { currentNovelMeta } from '@/types';
import { onMessage } from '@/entrypoints/background/messaging';
import { handleApiProxyRequest } from '@/utils/api-proxy-handler';
import { loadWebsiteSelectorsValue } from '@/utils/load-website-selectors';
import { setupApiClient } from '@/utils/setup-api-client';
import { browser } from '#imports';
import { defineBackground } from 'wxt/utils/define-background';

const tabNovels = new Map<number, currentNovelMeta>();

export default defineBackground(() => {
  setupApiClient();

  console.log('🔥', 'Background script loaded');

  browser.tabs.onRemoved.addListener((tabId) => {
    tabNovels.delete(tabId);
  });

  onMessage('reportCurrentNovel', ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (tabId === undefined) {
      return;
    }

    console.log('[StoryLens] Background cached tab novel', { tabId, novel: data });
    tabNovels.set(tabId, data);
  });

  onMessage('getCachedTabNovel', ({ data: tabId }) => {
    return tabNovels.get(tabId);
  });

  onMessage('getWebsiteSelectors', () => {
    return loadWebsiteSelectorsValue();
  });

  onMessage('apiRequest', ({ data }) => {
    return handleApiProxyRequest(data);
  });
});
