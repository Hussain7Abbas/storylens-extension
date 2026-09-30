import { useEffect } from "react";
import { sendMessage } from "@/entrypoints/background/messaging";
import { useLauncherShown } from "@/lib/launcher-frame/use-launcher-work";

// The novel site can send the launcher's "shown" message as well, so it is rate limited.
const SHOWN_SYNC_INTERVAL = 30_000;
let lastKick = 0;

function kickPopupSync(): void {
	lastKick = Date.now();
	void sendMessage("syncKick", { reason: "popup-open", pull: "stale" }).catch(
		(error) => {
			console.error("[StoryLens] Popup sync request failed", error);
		},
	);
}

/**
 * On popup (or launcher) open, asks the runner to send the outbox and pull
 * units that are stale. Fresh units are skipped and rejected changes are not
 * retried, so opening the popup twice in a minute costs nothing (U4). The
 * launcher keeps its popup loaded, so showing it again counts as an open, at
 * most once per half minute.
 */
export function usePopupAutoSync(enabled: boolean): void {
	useEffect(() => {
		if (enabled) kickPopupSync();
	}, [enabled]);
	useLauncherShown(() => {
		if (enabled && Date.now() - lastKick >= SHOWN_SYNC_INTERVAL)
			kickPopupSync();
	});
}
