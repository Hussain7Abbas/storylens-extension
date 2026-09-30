import { browser } from "#imports";
import { getStoredAuth } from "@/lib/auth/auth-storage";
import {
	isOfflineUnavailable,
	offlineDb,
	type StoryLensDatabase,
} from "@/lib/offline/db";
import { getMeta, type RunnerState } from "@/lib/offline/meta";
import { isOnline } from "@/lib/offline/online-status";
import type { Mutation } from "@/lib/offline/types";
import { TROUBLE_ATTEMPTS } from "./outcome";

export type SyncStatus = {
	online: boolean;
	runner: RunnerState;
	/** Unsent changes of the signed-in account (waiting or blocked included). */
	pending: number;
	/** Being sent right now. */
	sending: number;
	/** `conflict` or `rejected`: the reader decides. */
	attention: number;
	/** Made while signed in as another account; held (decision D10). */
	otherAccount: number;
	/** Some change failed to reach Story Lens many times (retries continue). */
	troubled: boolean;
	lastPushAt?: number;
	lastPullAt?: number;
	/** IndexedDB could not be opened: online-only mode. */
	unavailable: boolean;
};

/** Counts and state from the outbox; pure for tests. */
export function deriveStatus(
	mutations: Mutation[],
	{
		userId,
		runner,
		online,
		lastPushAt,
		lastPullAt,
	}: {
		userId: string | null | undefined;
		runner: RunnerState;
		online: boolean;
		lastPushAt?: number;
		lastPullAt?: number;
	},
): SyncStatus {
	const status: SyncStatus = {
		online,
		runner,
		pending: 0,
		sending: 0,
		attention: 0,
		otherAccount: 0,
		troubled: false,
		lastPushAt,
		lastPullAt,
		unavailable: false,
	};
	for (const mutation of mutations) {
		if (mutation.userId !== userId) {
			status.otherAccount += 1;
			continue;
		}
		if (mutation.status === "conflict" || mutation.status === "rejected")
			status.attention += 1;
		else if (mutation.status === "inflight") status.sending += 1;
		else status.pending += 1;
		if (mutation.attempts >= TROUBLE_ATTEMPTS) status.troubled = true;
	}
	return status;
}

export async function getSyncStatus(
	db: StoryLensDatabase = offlineDb(),
): Promise<SyncStatus> {
	const online = isOnline();
	if (isOfflineUnavailable()) {
		return {
			...deriveStatus([], { userId: null, runner: "idle", online }),
			unavailable: true,
		};
	}
	const [{ user }, mutations, runner, lastPushAt, lastPullAt] =
		await Promise.all([
			getStoredAuth(),
			db.mutations.toArray(),
			getMeta("runner", db),
			getMeta("lastPushAt", db),
			getMeta("lastPullAt", db),
		]);
	return deriveStatus(mutations, {
		userId: user?.id,
		runner: !online ? "offline" : (runner?.state ?? "idle"),
		online,
		lastPushAt,
		lastPullAt,
	});
}

export type Badge = { text: string; color: string };

/**
 * Toolbar badge: the account's unresolved changes; orange while pending, red
 * when anything needs attention, grey "!" when offline with nothing pending.
 */
export function badgeFor(status: SyncStatus): Badge {
	const count = status.pending + status.sending + status.attention;
	const text = count > 99 ? "99+" : count > 0 ? String(count) : "";
	if (status.attention > 0) return { text, color: "#e03131" };
	if (count > 0) return { text, color: "#f76707" };
	if (!status.online) return { text: "!", color: "#868e96" };
	return { text: "", color: "#868e96" };
}

export async function updateBadge(
	db: StoryLensDatabase = offlineDb(),
): Promise<SyncStatus> {
	const status = await getSyncStatus(db);
	const badge = badgeFor(status);
	try {
		await browser.action.setBadgeText({ text: badge.text });
		await browser.action.setBadgeBackgroundColor({ color: badge.color });
	} catch {
		// No toolbar action in this context.
	}
	return status;
}
