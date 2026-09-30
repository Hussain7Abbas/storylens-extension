import { browser } from "#imports";
import { trackAnalyticsEvent } from "@/lib/analytics/background";
import { getStoredAuth } from "@/lib/auth/auth-storage";
import { offlineDb, type StoryLensDatabase } from "@/lib/offline/db";
import { getMeta, type RunnerState, setMeta } from "@/lib/offline/meta";
import { isOnline } from "@/lib/offline/online-status";
import type { ConflictKind } from "@/lib/offline/types";
import { classify } from "./classify";
import { withSyncLock } from "./lock";
import { applyOutcome, leaseMutation, recoverExpiredLeases } from "./outcome";
import { checkProtocol } from "./protocol";
import { type PullMode, pullDueUnits, refreshKeywordVersions } from "./pull";
import { nextWakeAt, pickNext } from "./scheduler";
import { getSyncStatus, type SyncStatus, updateBadge } from "./status";
import { send } from "./transport";

export const PERIODIC_ALARM = "storylens-periodic-sync";
export const RETRY_ALARM = "storylens-sync-retry";
/** A run stops sending after about four minutes; the next run continues in order. */
export const RUN_DEADLINE_MS = 4 * 60 * 1000;
/** Consecutive server failures after which a run stops pushing. */
const MAX_SERVER_FAILURES = 3;

export type SyncReason =
	| "enqueue"
	| "popup-open"
	| "launcher-open"
	| "alarm"
	| "retry"
	| "startup"
	| "installed"
	| "online"
	| "auth-changed"
	| "manual"
	| "page"
	| "download";

export type RunOptions = {
	reason: SyncReason;
	/** Sync now: send waiting changes at once and pull every pinned novel. */
	manual?: boolean;
	pull?: PullMode;
	/** Pull the catalogue even when fresh (a page names a novel it does not have). */
	forceCatalogue?: boolean;
	db?: StoryLensDatabase;
	now?: () => number;
	deadlineMs?: number;
	/** Called after a unit changed novels (tabs showing them refresh). */
	onNovelsChanged?: (novelIds: string[]) => Promise<void> | void;
};

export type SyncRunSummary = {
	ran: boolean;
	state: RunnerState;
	sent: number;
	merged: number;
	conflicts: number;
	rejected: number;
	transientFailures: number;
	pulledUnits: number;
	failedPulls: number;
	durationMs: number;
};

function emptySummary(state: RunnerState, ran: boolean): SyncRunSummary {
	return {
		ran,
		state,
		sent: 0,
		merged: 0,
		conflicts: 0,
		rejected: 0,
		transientFailures: 0,
		pulledUnits: 0,
		failedPulls: 0,
		durationMs: 0,
	};
}

async function setRunner(
	db: StoryLensDatabase,
	state: RunnerState,
	now: number,
): Promise<void> {
	await setMeta("runner", { state, at: now }, db);
}

function reportConflict(kind: ConflictKind): void {
	void trackAnalyticsEvent({
		name: "sync_conflict_detected",
		params: { kind },
	}).catch(() => {});
}

/** Schedules the one-shot retry alarm at the earliest waiting change, or clears it. */
export async function scheduleRetry(
	db: StoryLensDatabase,
	userId: string | undefined,
	now: number,
): Promise<number | undefined> {
	const mutations = userId
		? await db.mutations.where("userId").equals(userId).toArray()
		: [];
	const wake = userId ? nextWakeAt(mutations, { userId, now }) : undefined;
	try {
		if (wake === undefined) await browser.alarms.clear(RETRY_ALARM);
		else
			await browser.alarms.create(RETRY_ALARM, {
				when: Math.max(now + 30_000, wake),
			});
	} catch {
		// No alarms in this context (tests of pure parts, content scripts).
	}
	return wake;
}

/** Creates the periodic alarm only when missing: re-creating it would postpone it forever (S1). */
export async function ensurePeriodicAlarm(): Promise<void> {
	const existing = await browser.alarms.get(PERIODIC_ALARM);
	if (!existing)
		await browser.alarms.create(PERIODIC_ALARM, { periodInMinutes: 5 });
}

async function runOnce(
	options: RunOptions,
	db: StoryLensDatabase,
): Promise<SyncRunSummary> {
	const now = options.now ?? Date.now;
	const started = now();
	const deadline = started + (options.deadlineMs ?? RUN_DEADLINE_MS);
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(),
		Math.max(0, deadline - started + 5_000),
	);
	const summary = emptySummary("running", true);
	try {
		await recoverExpiredLeases(db, now());
		const { user, token } = await getStoredAuth();
		if (!user || !token) {
			summary.state = "authRequired";
			await setRunner(db, summary.state, now());
			return summary;
		}
		if (!isOnline()) {
			summary.state = "offline";
			await setRunner(db, summary.state, now());
			await scheduleRetry(db, user.id, now());
			return summary;
		}
		await setRunner(db, "running", now());

		const protocol = await checkProtocol(db, {
			token,
			signal: controller.signal,
			now: now(),
		});
		if (protocol !== "ok") {
			summary.state =
				protocol === "outdated"
					? "apiOutdated"
					: protocol === "auth"
						? "authRequired"
						: protocol === "upgrade"
							? "upgradeRequired"
							: "offline";
			await setRunner(db, summary.state, now());
			await scheduleRetry(db, user.id, now());
			return summary;
		}

		// Push loop: one mutation at a time, in order per entity, after dependencies.
		const merges = new Map<string, number>();
		const touched = new Set<string>();
		let serverFailures = 0;
		let stop: "network" | "auth" | "upgrade" | undefined;
		while (now() < deadline && !stop) {
			// An account switch stops the loop: changes are only sent with their own account.
			const current = await getStoredAuth();
			if (current.user?.id !== user.id || !current.token) break;
			const mutations = await db.mutations
				.where("userId")
				.equals(user.id)
				.toArray();
			const next = pickNext(mutations, {
				userId: user.id,
				now: now(),
				manual: options.manual,
			});
			if (!next) break;
			const leased = await leaseMutation(db, next, now());
			if (!leased) continue;
			const result = await send(leased, {
				signal: controller.signal,
				token: current.token,
				db,
			});
			const outcome = classify(leased, result);
			const applied = await applyOutcome(db, leased, outcome, {
				now: now(),
				merges,
			});
			if (applied.result === "sent") summary.sent += 1;
			else if (applied.result === "merged") summary.merged += 1;
			else if (applied.result === "conflict") summary.conflicts += 1;
			else if (applied.result === "rejected") summary.rejected += 1;
			else if (applied.result === "transient") summary.transientFailures += 1;
			if (applied.attention) reportConflict(applied.attention);
			if (
				leased.novelId &&
				applied.result !== "transient" &&
				applied.result !== "paused"
			)
				touched.add(leased.novelId);
			if (applied.refreshVersionsOf) {
				await refreshKeywordVersions(applied.refreshVersionsOf, {
					db,
					token: current.token,
					signal: controller.signal,
				}).catch(() => {});
			}
			serverFailures =
				outcome.type === "transient" && outcome.reason === "server"
					? serverFailures + 1
					: 0;
			if (serverFailures >= MAX_SERVER_FAILURES) break;
			stop = applied.stop;
		}
		if (summary.sent || summary.merged) await setMeta("lastPushAt", now(), db);

		if (stop === "auth" || stop === "upgrade") {
			summary.state = stop === "auth" ? "authRequired" : "upgradeRequired";
		} else if (stop === "network") {
			summary.state = "offline";
		} else {
			const pulls = await pullDueUnits(
				{ db, token, signal: controller.signal, now: now() },
				{
					mode: options.pull ?? (options.manual ? "all" : "stale"),
					reason: options.reason,
					deadline,
					forceCatalogue: options.forceCatalogue,
				},
			);
			summary.pulledUnits = pulls.pulledUnits;
			summary.failedPulls = pulls.failedUnits;
			for (const novelId of pulls.changedNovels) touched.add(novelId);
			summary.state = "idle";
		}
		if (touched.size) await options.onNovelsChanged?.([...touched]);
		await setRunner(db, summary.state, now());
		await scheduleRetry(db, user.id, now());
		return summary;
	} finally {
		clearTimeout(timer);
		summary.durationMs = now() - started;
	}
}

/**
 * One sync run under the `storylens-sync` lock: recover expired leases, check
 * the account and the API protocol, send the outbox until the deadline, pull
 * due units, then update status, badge and the retry alarm. When the lock is
 * held, it records a rerun and returns at once; the holder runs once more.
 */
export async function runSync(options: RunOptions): Promise<SyncRunSummary> {
	const db = options.db ?? offlineDb();
	const outcome = await withSyncLock(async () => {
		let summary = await runOnce(options, db);
		// Runs requested meanwhile collapse into one more pass.
		for (let guard = 0; guard < 3 && (await getMeta("rerun", db)); guard++) {
			await setMeta("rerun", false, db);
			const again = await runOnce({ ...options, manual: false }, db);
			summary = {
				...again,
				sent: summary.sent + again.sent,
				merged: summary.merged + again.merged,
				conflicts: summary.conflicts + again.conflicts,
				rejected: summary.rejected + again.rejected,
				transientFailures: summary.transientFailures + again.transientFailures,
				pulledUnits: summary.pulledUnits + again.pulledUnits,
				failedPulls: summary.failedPulls + again.failedPulls,
				durationMs: summary.durationMs + again.durationMs,
			};
		}
		return summary;
	});
	if (!outcome.ran) {
		await setMeta("rerun", true, db);
		return emptySummary(
			((await getMeta("runner", db))?.state ?? "running") as RunnerState,
			false,
		);
	}
	const summary = outcome.value;
	console.log("[StoryLens] Sync run", { reason: options.reason, ...summary });
	await updateBadge(db).catch(() => undefined);
	return summary;
}

/** Status for the popup and the badge. */
export async function currentStatus(
	db: StoryLensDatabase = offlineDb(),
): Promise<SyncStatus> {
	return getSyncStatus(db);
}
