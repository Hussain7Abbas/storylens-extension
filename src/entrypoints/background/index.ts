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
import { updateSyncBadge } from "@/lib/offline/badge";
import { loadNovelContentDataForMeta } from "@/lib/offline/load-novel-content-data";
import { isOnline } from "@/lib/offline/online-status";
import { fullSync, syncPendingOperations } from "@/lib/offline/sync-engine";
import type { currentNovelMeta } from "@/types";
import type { websiteSelector } from "@/types/configs";
import { handleApiProxyRequest } from "@/utils/api-proxy-handler";
import {
	getCachedWebsiteSelector,
	loadWebsiteSelector,
	refreshWebsiteSelectorFromApi,
} from "@/utils/load-website-selectors";
import { setupApiClient } from "@/utils/setup-api-client";

const tabNovels = new Map<number, currentNovelMeta>();
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

const SYNC_ALARM_NAME = "storylens-periodic-sync";
const SYNC_INTERVAL_MINUTES = 5;

async function runSyncCycle(): Promise<void> {
	if (!isOnline()) {
		await updateSyncBadge();
		return;
	}

	await syncPendingOperations();
	await updateSyncBadge();
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

	void updateSyncBadge();
	void browser.alarms.create(SYNC_ALARM_NAME, {
		periodInMinutes: SYNC_INTERVAL_MINUTES,
	});

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
		tabNovels.delete(tabId);
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

	browser.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name === SYNC_ALARM_NAME) {
			void runSyncCycle();
		}
	});

	self.addEventListener("online", () => {
		void fullSync().then(() => updateSyncBadge());
	});

	self.addEventListener("offline", () => {
		void updateSyncBadge();
	});

	browser.storage.onChanged.addListener((changes, areaName) => {
		if (areaName === "local" && changes["storylens-sync-state"]) {
			void updateSyncBadge();
		}
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
		tabNovels.set(tabId, data);
	});

	onMessage("getCachedTabNovel", ({ data: tabId }) => {
		return tabNovels.get(tabId);
	});

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

	onMessage("getNovelContentData", ({ data }) => {
		return loadNovelContentDataForMeta(data);
	});

	onMessage("getOfflineNovelData", ({ data }) => {
		return loadNovelContentDataForMeta({
			novelSlug: data.novelSlug,
			chapter: data.chapter,
		});
	});

	onMessage("trackAnalyticsEvent", ({ data }) => trackAnalyticsEvent(data));

	onMessage("triggerFullSync", async () => {
		const result = await fullSync(true);
		await updateSyncBadge();
		return result;
	});
});
