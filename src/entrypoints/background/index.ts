import { defineBackground } from "wxt/utils/define-background";
import { browser } from "#imports";
import { onMessage, sendMessage } from "@/entrypoints/background/messaging";
import { trackAnalyticsEvent } from "@/lib/analytics/background";
import { setupAuthInterceptor } from "@/lib/auth/auth-service";
import { AUTH_STORAGE_KEY } from "@/lib/auth/auth-storage";
import {
	claimLensNotices,
	markLensNoticesSeen,
	refreshAiPricing,
	refreshLensBalance,
} from "@/lib/billing/background";
import {
	cancelCloudPrompt,
	cancelCloudTabPrompts,
	executeCloudPrompt,
	generateCloudImage,
} from "@/lib/cloud-ai/background";
import { serializeAiFailure } from "@/lib/cloud-ai/errors";
import {
	cancelPrompt,
	cancelTabPrompts,
	executeDesktopPrompt,
	generateDesktopImage,
	loadDesktopCapabilities,
	shareAccountSession,
} from "@/lib/desktop-client/background";
import { parseAiTaskReport } from "@/lib/launcher-frame/ai-tasks";
import { loadNovelContentDataForMeta } from "@/lib/offline/load-novel-content-data";
import {
	downloadNovel,
	initSyncBackground,
	kickSync,
	removeDownload,
	requestNovelRefresh,
	setTabNovelId,
	setTabRefresher,
	syncNow,
} from "@/lib/offline/sync/service";
import { getSyncStatus, updateBadge } from "@/lib/offline/sync/status";
import {
	getTabNovel,
	removeTabNovel,
	setTabNovel,
} from "@/lib/offline/sync/tabs";
import { websitePageUrl } from "@/lib/website";
import type { currentNovelMeta } from "@/types";
import type { websiteSelector } from "@/types/configs";
import { handleApiProxyRequest } from "@/utils/api-proxy-handler";
import {
	getCachedWebsiteSelector,
	loadWebsiteSelector,
	refreshWebsiteSelectorFromApi,
} from "@/utils/load-website-selectors";
import { setupApiClient } from "@/utils/setup-api-client";
import { getStoredLanguage } from "@/utils/stored-language";

/** Owner key for desktop jobs started by an extension page outside a tab (the toolbar popup). */
const EXTENSION_PAGE_OWNER = -1;

/**
 * Desktop AI jobs come from a tab (content scripts and the launcher popup
 * frame), keyed by that tab so closing it cancels them, or from the toolbar
 * popup, which has no tab and shares one owner key.
 */
function desktopJobOwner(sender: {
	tab?: { id?: number };
	url?: string;
	id?: string;
}): number {
	if (sender.id !== browser.runtime.id)
		throw new Error("Only Story Lens can request AI execution.");
	if (sender.tab?.id !== undefined) return sender.tab.id;
	if (!sender.url?.startsWith(browser.runtime.getURL("/")))
		throw new Error("Only Story Lens pages can request AI execution.");
	return EXTENSION_PAGE_OWNER;
}

/** Page data for a detected novel, pulling it through the runner when it is missing. */
function contentDataFor(meta: currentNovelMeta) {
	return loadNovelContentDataForMeta(meta, {
		kick: (options) => kickSync("page", options),
		onResolved: setTabNovelId,
	});
}

async function notifyWebsiteSelectorUpdated(
	website: string,
	selector: websiteSelector,
): Promise<void> {
	const tabs = await browser.tabs.query({});
	for (const tab of tabs) {
		if (tab.id === undefined || !tab.url) {
			continue;
		}

		let tabWebsite: string | undefined;
		try {
			tabWebsite = new URL(tab.url).hostname;
		} catch {
			continue;
		}

		if (tabWebsite !== website) {
			continue;
		}

		try {
			await sendMessage(
				"websiteSelectorUpdated",
				{ website, selector },
				{ tabId: tab.id },
			);
		} catch {
			// Tab may not have a content script loaded.
		}
	}
}

async function refreshWebsiteSelectorInBackground(
	website: string,
): Promise<void> {
	const result = await refreshWebsiteSelectorFromApi(website);
	if (result.changed && result.selector) {
		await notifyWebsiteSelectorUpdated(website, result.selector);
	}
}

export default defineBackground(() => {
	setupApiClient();
	setupAuthInterceptor();

	console.log("🔥", "Background script loaded");

	initSyncBackground();
	browser.runtime.onStartup.addListener(() => {
		void refreshAiPricing(0);
	});
	onMessage("refreshAiBilling", async ({ sender }) => {
		desktopJobOwner(sender);
		await Promise.all([refreshAiPricing(), refreshLensBalance()]);
	});
	onMessage("claimLensNotices", ({ data, sender }) => {
		desktopJobOwner(sender);
		return claimLensNotices(data);
	});
	onMessage("markLensNoticesSeen", ({ data, sender }) => {
		desktopJobOwner(sender);
		return markLensNoticesSeen(data);
	});
	onMessage("openLensPage", async ({ data, sender }) => {
		desktopJobOwner(sender);
		const query = new URLSearchParams({ from: "extension" });
		if (Number.isSafeInteger(data.need) && (data.need ?? 0) > 0)
			query.set("need", String(data.need));
		if (data.feature) query.set("feature", data.feature);
		const path =
			data.reason === "guest"
				? "profile/register/"
				: `profile/balance/?${query}#request`;
		await browser.tabs.create({
			url: websitePageUrl(await getStoredLanguage(), path),
		});
		void trackAnalyticsEvent({
			name: "lens_balance_opened",
			params: { reason: data.reason },
		});
	});
	onMessage("executeAiPrompt", async ({ data, sender }) => {
		const owner = desktopJobOwner(sender);
		try {
			return {
				ok: true as const,
				value: await (data.source === "cloud"
					? executeCloudPrompt(data, owner)
					: executeDesktopPrompt(data, owner)),
			};
		} catch (error) {
			return { ok: false as const, failure: serializeAiFailure(error) };
		}
	});
	onMessage("generateAiImage", async ({ data, sender }) => {
		const owner = desktopJobOwner(sender);
		try {
			return {
				ok: true as const,
				value: await (data.source === "cloud"
					? generateCloudImage(data, owner)
					: generateDesktopImage(data, owner)),
			};
		} catch (error) {
			return { ok: false as const, failure: serializeAiFailure(error) };
		}
	});
	onMessage("cancelAiPrompt", ({ data, sender }) => {
		const owner = desktopJobOwner(sender);
		cancelPrompt(data, owner);
		cancelCloudPrompt(data, owner);
	});
	setTabRefresher((tabId, novelSlug) =>
		sendMessage("refreshContent", { novelSlug }, { tabId }),
	);

	browser.runtime.onInstalled.addListener((details) => {
		void refreshAiPricing(0);
		if (details.reason === "install") {
			void browser.tabs.create({
				url: websitePageUrl(
					browser.i18n.getUILanguage().startsWith("ar") ? "ar" : "en",
					"profile/?from=install",
				),
			});
			void trackAnalyticsEvent({ name: "extension_install" });
		} else if (details.reason === "update") {
			void trackAnalyticsEvent({
				name: "extension_update",
				params: { previous_version: details.previousVersion ?? "" },
			});
		}
	});

	browser.tabs.onRemoved.addListener((tabId) => {
		void removeTabNovel(tabId);
		cancelTabPrompts(tabId);
		cancelCloudTabPrompts(tabId);
	});

	onMessage("desktopCapabilities", () => loadDesktopCapabilities());
	onMessage("executeDesktopPrompt", ({ data, sender }) =>
		executeDesktopPrompt(data, desktopJobOwner(sender)),
	);
	onMessage("generateDesktopImage", ({ data, sender }) =>
		generateDesktopImage(data, desktopJobOwner(sender)),
	);
	onMessage("cancelDesktopPrompt", ({ data, sender }) => {
		cancelPrompt(data, desktopJobOwner(sender));
	});

	browser.storage.onChanged.addListener((changes, areaName) => {
		// Keep the paired desktop client's crawler on the current account.
		if (areaName === "local" && changes[AUTH_STORAGE_KEY]) {
			void shareAccountSession().catch(() => {});
			void refreshLensBalance();
		}
	});

	onMessage("reportCurrentNovel", ({ data, sender }) => {
		const tabId = sender.tab?.id;
		if (tabId === undefined) {
			return;
		}

		console.log("[StoryLens] Background cached tab novel", {
			tabId,
			novel: data,
		});
		void setTabNovel(tabId, data);
	});

	onMessage("getCachedTabNovel", ({ data: tabId }) => getTabNovel(tabId));

	onMessage("getWebsiteSelector", async ({ data: website }) => {
		const cached = await getCachedWebsiteSelector(website);
		void refreshWebsiteSelectorInBackground(website);

		if (cached) {
			return cached;
		}

		return loadWebsiteSelector(website);
	});

	onMessage("apiRequest", ({ data }) => {
		return handleApiProxyRequest(data);
	});

	onMessage("getNovelContentData", ({ data }) => contentDataFor(data));

	onMessage("getOfflineNovelData", ({ data }) =>
		contentDataFor({ novelSlug: data.novelSlug, chapter: data.chapter }),
	);

	onMessage("trackAnalyticsEvent", ({ data }) => trackAnalyticsEvent(data));
	onMessage("reportAiTask", ({ data, sender }) => {
		// Only Story Lens pages framed in a tab have a launcher to show the task.
		const tabId = sender.tab?.id;
		if (
			sender.id !== browser.runtime.id ||
			tabId === undefined ||
			!sender.url?.startsWith(browser.runtime.getURL("/"))
		)
			return;
		const report = parseAiTaskReport(data);
		if (!report || report.source === "page") return;
		void sendMessage("aiTaskUpdated", report, { tabId, frameId: 0 }).catch(
			() => {},
		);
	});

	onMessage("syncKick", async ({ data }) => {
		void kickSync(data.reason, {
			pull: data.pull,
			forceCatalogue: data.forceCatalogue,
		});
		return updateBadge();
	});
	onMessage("syncNow", () => syncNow());
	onMessage("getSyncStatus", () => getSyncStatus());
	onMessage("downloadNovel", ({ data: novelId }) => downloadNovel(novelId));
	onMessage("removeDownload", ({ data }) =>
		removeDownload(data.novelId, { discardPending: data.discardPending }),
	);
	onMessage("requestNovelRefresh", ({ data: novelId }) =>
		requestNovelRefresh(novelId),
	);
});
