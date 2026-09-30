import type { SyncStatus } from "./status";

export type SyncIndicator = {
	icon: "synced" | "pending" | "sending" | "offline" | "attention" | "paused";
	/** Count shown on the button (unsent changes, or ones needing attention). */
	count: number;
	/** i18n key of the popover's state line. */
	message:
		| "sync.status.synced"
		| "sync.status.pending"
		| "sync.status.sending"
		| "sync.status.offline"
		| "sync.status.authRequired"
		| "sync.status.upgradeRequired"
		| "sync.status.apiOutdated"
		| "sync.status.unavailable";
	action?: "signIn" | "update";
	troubled: boolean;
	canSyncNow: boolean;
};

/** What the navbar shows for a sync status (pure; every state has a test). */
export function syncIndicator(status: SyncStatus): SyncIndicator {
	const unsent = status.pending + status.sending;
	const base = {
		count: status.attention || unsent,
		troubled: status.troubled,
		canSyncNow: status.online,
	};
	if (status.unavailable)
		return {
			...base,
			icon: "offline",
			message: "sync.status.unavailable",
			canSyncNow: false,
		};
	if (status.runner === "authRequired")
		return {
			...base,
			icon: "paused",
			message: "sync.status.authRequired",
			action: "signIn",
		};
	if (status.runner === "upgradeRequired")
		return {
			...base,
			icon: "paused",
			message: "sync.status.upgradeRequired",
			action: "update",
		};
	if (status.runner === "apiOutdated")
		return { ...base, icon: "paused", message: "sync.status.apiOutdated" };
	if (!status.online)
		return {
			...base,
			icon: "offline",
			message: "sync.status.offline",
			canSyncNow: false,
		};
	if (status.attention)
		return {
			...base,
			icon: "attention",
			message: unsent ? "sync.status.pending" : "sync.status.synced",
		};
	if (status.sending || status.runner === "running")
		return { ...base, icon: "sending", message: "sync.status.sending" };
	if (unsent)
		return { ...base, icon: "pending", message: "sync.status.pending" };
	return { ...base, icon: "synced", message: "sync.status.synced" };
}
