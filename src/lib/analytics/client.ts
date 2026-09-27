import { sendMessage } from "@/entrypoints/background/messaging";
import type { AnalyticsEvent } from "@/lib/analytics/types";

// Popup and content scripts forward events so client/session IDs and the
// network request live in the background service worker.
export function trackEvent(
	name: AnalyticsEvent["name"],
	params?: AnalyticsEvent["params"],
): void {
	void sendMessage("trackAnalyticsEvent", { name, params }).catch(() => {
		// Analytics must never interrupt the extension.
	});
}
