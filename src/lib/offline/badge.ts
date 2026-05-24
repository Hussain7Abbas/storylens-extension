import { browser } from "#imports";
import { isOnline } from "@/lib/offline/online-status";
import { getPendingOpsCount } from "@/lib/offline/sync-storage";

export async function updateSyncBadge(): Promise<void> {
	const pendingCount = await getPendingOpsCount();
	const online = isOnline();

	if (!online) {
		await browser.action.setBadgeText({ text: "!" });
		await browser.action.setBadgeBackgroundColor({ color: "#868e96" });
		return;
	}

	if (pendingCount > 0) {
		await browser.action.setBadgeText({
			text: pendingCount > 99 ? "99+" : String(pendingCount),
		});
		await browser.action.setBadgeBackgroundColor({ color: "#f76707" });
		return;
	}

	await browser.action.setBadgeText({ text: "" });
}
