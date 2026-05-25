import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { sendMessage } from "@/entrypoints/background/messaging";
import { isOnline } from "@/lib/offline/online-status";

export function usePopupAutoSync(enabled: boolean): void {
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!enabled || !isOnline()) {
			return;
		}

		void (async () => {
			try {
				await sendMessage("triggerFullSync");
				await queryClient.invalidateQueries({ queryKey: ["offline"] });
			} catch (error) {
				console.error("[StoryLens] Popup auto-sync failed", error);
			}
		})();
	}, [enabled, queryClient]);
}
