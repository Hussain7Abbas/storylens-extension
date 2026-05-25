import { defineBackground } from "wxt/utils/define-background";
import { browser } from "#imports";
import { onMessage } from "@/entrypoints/background/messaging";
import { updateSyncBadge } from "@/lib/offline/badge";
import {
	getKeywordsByNovelId,
	getOfflineNovelBySlug,
	getReplacementsByNovelId,
} from "@/lib/offline/db";
import { isOnline } from "@/lib/offline/online-status";
import { fullSync, syncPendingOperations } from "@/lib/offline/sync-engine";
import type { currentNovelMeta } from "@/types";
import type { NovelContentData } from "@/types/content-data";
import { handleApiProxyRequest } from "@/utils/api-proxy-handler";
import { loadWebsiteSelectorsValue } from "@/utils/load-website-selectors";
import { setupApiClient } from "@/utils/setup-api-client";
import { setupAuthInterceptor } from "@/lib/auth/auth-service";

const tabNovels = new Map<number, currentNovelMeta>();
const SYNC_ALARM_NAME = "storylens-periodic-sync";
const SYNC_INTERVAL_MINUTES = 5;

async function loadOfflineNovelContentData(
	novelSlug: string,
	chapter?: number,
): Promise<NovelContentData | undefined> {
	const novel = await getOfflineNovelBySlug(novelSlug);
	if (!novel) {
		return undefined;
	}

	const [keywords, replacements] = await Promise.all([
		getKeywordsByNovelId(novel.id),
		getReplacementsByNovelId(novel.id),
	]);

	return {
		novel,
		chapterNumber: chapter,
		keywords,
		replacements,
	};
}

async function runSyncCycle(): Promise<void> {
	if (!isOnline()) {
		await updateSyncBadge();
		return;
	}

	await syncPendingOperations();
	await updateSyncBadge();
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

	onMessage("getWebsiteSelectors", () => {
		return loadWebsiteSelectorsValue();
	});

	onMessage("apiRequest", ({ data }) => {
		return handleApiProxyRequest(data);
	});

	onMessage("getOfflineNovelData", async ({ data }) => {
		return loadOfflineNovelContentData(data.novelSlug, data.chapter);
	});

	onMessage("triggerFullSync", async () => {
		const result = await fullSync();
		await updateSyncBadge();
		return result;
	});
});
