import { defineExtensionMessaging } from "@webext-core/messaging";
import type { SyncResult } from "@/lib/offline/sync-engine";
import type { currentNovelMeta } from "@/types";
import type { ApiProxyRequest, ApiProxyResponse } from "@/types/api-proxy";
import type { NovelContentData } from "@/types/content-data";

interface ProtocolMap {
	getCurrentNovel(): currentNovelMeta | undefined;
	getPageHtml(): { url: string; html: string } | undefined;
	reportCurrentNovel(data: currentNovelMeta): void;
	getCachedTabNovel(tabId: number): currentNovelMeta | undefined;
	getWebsiteSelectors(): string | undefined;
	refreshContent(): void;
	apiRequest<T = unknown>(data: ApiProxyRequest): ApiProxyResponse<T>;
	getOfflineNovelData(data: {
		novelSlug: string;
		chapter?: number;
	}): NovelContentData | undefined;
	triggerFullSync(): SyncResult;
}

export const { sendMessage, onMessage } =
	defineExtensionMessaging<ProtocolMap>();
