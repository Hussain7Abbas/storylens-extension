import { browser } from "#imports";
import { sendMessage } from "@/entrypoints/background/messaging";

export async function refreshContentScript(): Promise<boolean> {
	const [tab] = await browser.tabs.query({
		active: true,
		lastFocusedWindow: true,
	});
	if (!tab?.id) {
		console.error("[StoryLens] Refresh failed: no active tab");
		return false;
	}

	try {
		await sendMessage("refreshContent", undefined, { tabId: tab.id });
		return true;
	} catch (error) {
		console.error("[StoryLens] Refresh failed", error);
		return false;
	}
}
