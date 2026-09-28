import { defineExtensionMessaging } from "@webext-core/messaging";
import type { AnalyticsEvent } from "@/lib/analytics/types";
import type {
	DesktopCapabilities,
	ExecutePromptInput,
	GeneratedImage,
	GenerateImageInput,
} from "@/lib/desktop-client/types";
import type { SyncResult } from "@/lib/offline/sync-engine";
import type { currentNovelMeta } from "@/types";
import type { ApiProxyRequest, ApiProxyResponse } from "@/types/api-proxy";
import type { websiteSelector } from "@/types/configs";
import type { NovelContentData } from "@/types/content-data";

interface ProtocolMap {
	desktopCapabilities(): DesktopCapabilities;
	executeDesktopPrompt(data: ExecutePromptInput): string;
	generateDesktopImage(data: GenerateImageInput): GeneratedImage;
	cancelDesktopPrompt(requestId: string): void;
	getCurrentNovel(): currentNovelMeta | undefined;
	getPageHtml(): { url: string; html: string } | undefined;
	getChapterText(): { text: string };
	reportCurrentNovel(data: currentNovelMeta): void;
	getCachedTabNovel(tabId: number): currentNovelMeta | undefined;
	getWebsiteSelector(website: string): websiteSelector | undefined;
	websiteSelectorUpdated(data: {
		website: string;
		selector: websiteSelector;
	}): void;
	refreshContent(): void;
	apiRequest<T = unknown>(data: ApiProxyRequest): ApiProxyResponse<T>;
	getOfflineNovelData(data: {
		novelSlug: string;
		chapter?: number;
	}): NovelContentData | undefined;
	getNovelContentData(data: currentNovelMeta): NovelContentData | undefined;
	triggerFullSync(): SyncResult;
	trackAnalyticsEvent(data: AnalyticsEvent): void;
}

export const { sendMessage, onMessage } =
	defineExtensionMessaging<ProtocolMap>();
