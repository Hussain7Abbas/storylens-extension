import { browser } from "#imports";
import { AUTH_STORAGE_KEY, getStoredAuth } from "@/lib/auth/auth-storage";
import {
	allTables,
	offlineDb,
	openOfflineDb,
	type StoryLensDatabase,
} from "@/lib/offline/db";
import {
	bumpChangeCounter,
	getNovelSync,
	markPullDue,
	pinNovel,
	requestRefresh,
	unpinNovel,
} from "@/lib/offline/meta";
import { isOnline } from "@/lib/offline/online-status";
import { dependantsOf, sweepOrphanFiles } from "@/lib/offline/outbox";
import { removeNovelSnapshot } from "@/lib/offline/snapshot";
import { deleteOldStorage } from "@/lib/offline/upgrade-cleanup";
import { withSyncLock } from "./lock";
import { type PullMode, pullNovel } from "./pull";
import {
	ensurePeriodicAlarm,
	PERIODIC_ALARM,
	RETRY_ALARM,
	runSync,
	type SyncReason,
	type SyncRunSummary,
} from "./runner";
import { getSyncStatus, type SyncStatus, updateBadge } from "./status";
import { refreshNovelTabs, setTabNovelId } from "./tabs";

export type RefreshTab = (tabId: number, novelSlug: string) => Promise<unknown>;

let refreshTab: RefreshTab = async () => undefined;

/** How the background tells a tab to re-run highlighting (messaging lives in the entrypoint). */
export function setTabRefresher(send: RefreshTab): void {
	refreshTab = send;
}

async function onNovelsChanged(novelIds: string[]): Promise<void> {
	await refreshNovelTabs(novelIds, refreshTab);
}

/** Starts a run without waiting for it; errors are logged. */
export function kickSync(
	reason: SyncReason,
	options: { pull?: PullMode; forceCatalogue?: boolean; manual?: boolean } = {},
): Promise<SyncRunSummary | undefined> {
	return runSync({ reason, onNovelsChanged, ...options }).catch((error) => {
		console.error("[StoryLens] Sync run failed", error);
		return undefined;
	});
}

/** Sync now: sends waiting changes at once and pulls every pinned novel. */
export async function syncNow(): Promise<{
	summary: SyncRunSummary | undefined;
	status: SyncStatus;
}> {
	const summary = await runSync({
		reason: "manual",
		manual: true,
		pull: "all",
		onNovelsChanged,
	});
	return { summary, status: await getSyncStatus() };
}

/** A cached novel's view is stale: pull it in the background (stale-while-revalidate). */
export async function requestNovelRefresh(novelId: string): Promise<void> {
	await requestRefresh(novelId);
	void kickSync("page");
}

async function waitUntil(
	check: () => Promise<boolean>,
	timeoutMs: number,
): Promise<boolean> {
	const until = Date.now() + timeoutMs;
	while (Date.now() < until) {
		if (await check()) return true;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	return check();
}

/**
 * Downloads a novel: pins it and pulls it under the sync lock (the popup never
 * writes the snapshot). Offline, it answers `offline`.
 */
export async function downloadNovel(
	novelId: string,
	db: StoryLensDatabase = offlineDb(),
): Promise<{ ok: true } | { error: string }> {
	if (!isOnline()) return { error: "offline" };
	const { token } = await getStoredAuth();
	if (!token) return { error: "signed-out" };
	await pinNovel(novelId, db);
	const locked = await withSyncLock(() => pullNovel(novelId, { db, token }));
	if (locked.ran) {
		await bumpChangeCounter(db);
		return locked.value === "removed" ? { error: "removed" } : { ok: true };
	}
	// A run holds the lock: it pulls the novel in its rerun.
	await markPullDue(novelId, db);
	void kickSync("download");
	const pulled = await waitUntil(
		async () => !!(await getNovelSync(novelId, db))?.lastPulledAt,
		60_000,
	);
	return pulled ? { ok: true } : { error: "timeout" };
}

/**
 * Removes a download. With unresolved changes for the novel and no
 * `discardPending`, answers `{ blocked }` so the popup can ask the reader;
 * otherwise discards them (with their dependants), unpins and deletes the
 * novel's snapshot rows. The next visit caches the novel again if needed.
 */
export async function removeDownload(
	novelId: string,
	{ discardPending = false }: { discardPending?: boolean } = {},
	db: StoryLensDatabase = offlineDb(),
): Promise<{ ok: true } | { blocked: number } | { error: string }> {
	const { user } = await getStoredAuth();
	const mutations = user
		? await db.mutations.where("userId").equals(user.id).toArray()
		: [];
	const own = mutations.filter((mutation) => mutation.novelId === novelId);
	if (own.length && !discardPending) return { blocked: own.length };

	for (let attempt = 0; attempt < 50; attempt++) {
		const locked = await withSyncLock(() =>
			db.transaction("rw", allTables(db), async () => {
				const doomed = new Map(own.map((mutation) => [mutation.id, mutation]));
				for (const mutation of own)
					for (const dependant of dependantsOf(mutations, mutation.entityId))
						doomed.set(dependant.id, dependant);
				for (const mutation of doomed.values()) {
					if (mutation.seq !== undefined)
						await db.mutations.delete(mutation.seq);
					if (mutation.entity === "file")
						await db.files.delete(mutation.entityId);
				}
				await removeNovelSnapshot(db, novelId);
				await unpinNovel(novelId, db);
				const sync = await db.novelSync.get(novelId);
				if (sync)
					await db.novelSync.put({
						novelId,
						pinned: 0,
						removedOnServer: sync.removedOnServer,
					});
				// A novel the server removed leaves the catalogue with its download.
				if (sync?.removedOnServer) await db.novels.delete(novelId);
				await bumpChangeCounter(db, [novelId]);
			}),
		);
		if (locked.ran) {
			await updateBadge(db).catch(() => undefined);
			return { ok: true };
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	return { error: "busy" };
}

/**
 * Background wiring for the offline engine: opens the database, deletes 3.2.x
 * storage, keeps the periodic alarm (created only when missing) and runs the
 * runner on every trigger.
 */
export function initSyncBackground(): void {
	void (async () => {
		await openOfflineDb();
		await deleteOldStorage();
		await sweepOrphanFiles().catch(() => 0);
		await ensurePeriodicAlarm().catch(() => undefined);
		await updateBadge().catch(() => undefined);
	})();

	browser.runtime.onInstalled.addListener((details) => {
		void (async () => {
			if (details.reason === "update") await deleteOldStorage();
			await kickSync("installed");
		})();
	});
	browser.runtime.onStartup.addListener(() => {
		void kickSync("startup");
	});
	browser.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name === PERIODIC_ALARM) void kickSync("alarm");
		if (alarm.name === RETRY_ALARM) void kickSync("retry", { pull: "none" });
	});
	self.addEventListener("online", () => {
		void kickSync("online", { pull: "none" });
	});
	self.addEventListener("offline", () => {
		void updateBadge().catch(() => undefined);
	});
	browser.storage.onChanged.addListener((changes, areaName) => {
		// Signing in (or switching accounts) resumes from `authRequired` and sends
		// that account's changes; other accounts' changes stay held.
		if (areaName === "local" && changes[AUTH_STORAGE_KEY])
			void kickSync("auth-changed", { pull: "none" });
	});
}

export { setTabNovelId };
