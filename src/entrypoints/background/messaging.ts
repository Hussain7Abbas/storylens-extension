import { defineExtensionMessaging } from "@webext-core/messaging";
import type { AiFeature } from "@/lib/ai-source/source";
import type { AnalyticsEvent } from "@/lib/analytics/types";
import type { AiReply } from "@/lib/cloud-ai/errors";
import type { AiImageInput, AiPromptInput } from "@/lib/cloud-ai/types";
import type {
	DesktopCapabilities,
	ExecutePromptInput,
	GeneratedImage,
	GenerateImageInput,
} from "@/lib/desktop-client/types";
import type { AiTaskReport, AiTaskUpdate } from "@/lib/launcher-frame/ai-tasks";
import type { PullMode } from "@/lib/offline/sync/pull";
import type { SyncReason, SyncRunSummary } from "@/lib/offline/sync/runner";
import type { SyncStatus } from "@/lib/offline/sync/status";
import type { currentNovelMeta } from "@/types";
import type { ApiProxyRequest, ApiProxyResponse } from "@/types/api-proxy";
import type { websiteSelector } from "@/types/configs";
import type { NovelContentData } from "@/types/content-data";

interface ProtocolMap {
	executeAiPrompt(data: AiPromptInput): AiReply<string>;
	generateAiImage(data: AiImageInput): AiReply<GeneratedImage>;
	cancelAiPrompt(requestId: string): void;
	refreshAiBilling(): void;
	claimLensNotices(data: { userId: string; ids: string[] }): string[];
	markLensNoticesSeen(data: { userId: string; ids: string[] }): boolean;
	openLensPage(data: {
		need?: number;
		have?: number;
		feature?: AiFeature;
		reason: "insufficient" | "navbar" | "settings" | "guest";
	}): void;
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
	/** Re-run highlighting; a tab ignores a refresh meant for another novel. */
	refreshContent(data?: { novelSlug?: string }): void;
	apiRequest<T = unknown>(data: ApiProxyRequest): ApiProxyResponse<T>;
	getOfflineNovelData(data: {
		novelSlug: string;
		chapter?: number;
	}): NovelContentData | undefined;
	getNovelContentData(data: currentNovelMeta): NovelContentData | undefined;
	/** Best effort after an enqueue or on popup open: returns at once. */
	syncKick(data: {
		reason: SyncReason;
		pull?: PullMode;
		forceCatalogue?: boolean;
	}): SyncStatus;
	syncNow(): { summary: SyncRunSummary | undefined; status: SyncStatus };
	getSyncStatus(): SyncStatus;
	downloadNovel(novelId: string): { ok: true } | { error: string };
	removeDownload(data: {
		novelId: string;
		discardPending?: boolean;
	}): { ok: true } | { blocked: number } | { error: string };
	requestNovelRefresh(novelId: string): void;
	trackAnalyticsEvent(data: AnalyticsEvent): void;
	/** A Story Lens frame's AI task, relayed to the launcher of its tab. */
	reportAiTask(data: AiTaskUpdate & { source: "popup" | "panel" }): void;
	/** Background → content script: an AI task of a Story Lens frame in this tab. */
	aiTaskUpdated(data: AiTaskReport): void;
}

export const { sendMessage, onMessage } =
	defineExtensionMessaging<ProtocolMap>();
