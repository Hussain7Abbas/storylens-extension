import { useEffect } from "react";
import { sendMessage } from "@/entrypoints/background/messaging";

/**
 * On popup (or launcher) open, asks the runner to send the outbox and pull
 * units that are stale. Fresh units are skipped and rejected changes are not
 * retried, so opening the popup twice in a minute costs nothing (U4).
 */
export function usePopupAutoSync(enabled: boolean): void {
	useEffect(() => {
		if (!enabled) return;
		void sendMessage("syncKick", { reason: "popup-open", pull: "stale" }).catch(
			(error) => {
				console.error("[StoryLens] Popup sync request failed", error);
			},
		);
	}, [enabled]);
}
