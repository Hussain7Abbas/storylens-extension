import type { ApiProxyRequest, ApiProxyResponse } from '@/types/api-proxy';
import type { currentNovelMeta } from '@/types';
import { defineExtensionMessaging } from '@webext-core/messaging';

interface ProtocolMap {
  getCurrentNovel(): currentNovelMeta | undefined;
  getPageHtml(): { url: string; html: string } | undefined;
  reportCurrentNovel(data: currentNovelMeta): void;
  getCachedTabNovel(tabId: number): currentNovelMeta | undefined;
  getWebsiteSelectors(): string | undefined;
  refreshContent(): void;
  apiRequest<T = unknown>(data: ApiProxyRequest): ApiProxyResponse<T>;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
