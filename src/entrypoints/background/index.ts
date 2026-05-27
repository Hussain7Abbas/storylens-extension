import { defineBackground } from "wxt/utils/define-background";
import { browser } from "#imports";
import { onMessage, sendMessage } from "@/entrypoints/background/messaging";
import { setupAuthInterceptor } from "@/lib/auth/auth-service";
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

	browser.tabs.onRemoved.addListener((tabId) => {
		tabNovels.delete(tabId);
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

	onMessage("triggerFullSync", async () => {
		const result = await fullSync();
		await updateSyncBadge();
		return result;
	});
});
