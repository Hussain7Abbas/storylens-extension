import { useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useState } from "react";
import toast from "react-hot-toast";
import { sendMessage } from "@/entrypoints/background/messaging";
import { trackEvent } from "@/lib/analytics/client";
import { syncIndicator } from "@/lib/offline/sync/indicator";

export function useManualSync(t: TFunction) {
	const queryClient = useQueryClient();
	const [syncing, setSyncing] = useState(false);
	const syncNow = async () => {
		setSyncing(true);
		trackEvent("sync_manual_requested");
		try {
			const { summary, status: after } = await sendMessage("syncNow");
			if (after.attention || after.otherAccount) {
				toast.error(
					t("sync.summaryAttention", {
						sent: summary?.sent ?? 0,
						count: after.attention + after.otherAccount,
					}),
					{ duration: 8000 },
				);
			} else if (after.pending) {
				toast(
					t("sync.summaryIncomplete", {
						sent: summary?.sent ?? 0,
						count: after.pending,
					}),
				);
			} else if (!summary?.ran || after.runner !== "idle") {
				toast(t(syncIndicator(after).message));
			} else if (after.pullIssues?.length || after.lastRunError) {
				toast.error(t("sync.summaryPullFailed"));
			} else {
				toast.success(
					(summary?.sent ?? 0) > 0
						? t("sync.summaryDone", { sent: summary?.sent })
						: t("sync.summaryUpToDate"),
				);
			}
		} catch {
			toast.error(t("offline.syncFailed"));
		} finally {
			await queryClient.invalidateQueries({ queryKey: ["offline"] });
			setSyncing(false);
		}
	};
	return { syncing, syncNow };
}
