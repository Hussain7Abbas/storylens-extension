import { defineBackground } from "wxt/utils/define-background";
import { browser } from "#imports";
import { onMessage, sendMessage } from "@/entrypoints/background/messaging";
import { trackAnalyticsEvent } from "@/lib/analytics/background";
import { setupAuthInterceptor } from "@/lib/auth/auth-service";
import { AUTH_STORAGE_KEY } from "@/lib/auth/auth-storage";
import {
	cancelPrompt,
	cancelTabPrompts,
	executeDesktopPrompt,
	generateDesktopImage,
	loadDesktopCapabilities,
	shareAccountSession,
} from "@/lib/desktop-client/background";
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
import type { currentNovelMeta } from "@/types";
import type { websiteSelector } from "@/types/configs";
import { handleApiProxyRequest } from "@/utils/api-proxy-handler";
import {
	getCachedWebsiteSelector,
	loadWebsiteSelector,
	refreshWebsiteSelectorFromApi,
} from "@/utils/load-website-selectors";
import { setupApiClient } from "@/utils/setup-api-client";

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
	setTabRefresher((tabId, novelSlug) =>
		sendMessage("refreshContent", { novelSlug }, { tabId }),
	);

	browser.runtime.onInstalled.addListener((details) => {
		if (details.reason === "install") {
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
