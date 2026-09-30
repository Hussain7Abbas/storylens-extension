import { offlineDb, type StoryLensDatabase } from "@/lib/offline/db";
import type { NovelSync } from "@/lib/offline/types";

// ---------------------------------------------------------------------------
// syncMeta: typed key-value state of the runner and the pulls
// ---------------------------------------------------------------------------

export type RunnerState =
	| "idle"
	| "running"
	| "offline"
	| "authRequired"
	| "upgradeRequired"
	| "apiOutdated";

export type SyncMetaValues = {
	/** Last protocol check: the API's version, or null when it has no protocol endpoint. */
	protocol: { version: number | null; checkedAt: number };
	runner: { state: RunnerState; at: number; transientFailures?: number };
	lastPushAt: number;
	lastPullAt: number;
	catalogPulledAt: number;
	lookupsPulledAt: number;
	lookupsFullPullAt: number;
	catalogFullPullAt: number;
	/** Bumped by every outbox or snapshot write; views cached in memory compare it. */
	changeCounter: number;
	/** Bumped per novel when its view changes, so tabs showing it refresh. */
	novelCounters: Record<string, number>;
	lookupsCursor: number;
	catalogueCursor: number;
	/** A run was requested while another held the lock; the holder runs once more. */
	rerun: boolean;
	/** A 3.2.x storage cleanup still has something to delete. */
	oldStorageCleaned: boolean;
};

export type SyncMetaKey = keyof SyncMetaValues;

export async function getMeta<K extends SyncMetaKey>(
	key: K,
	db: StoryLensDatabase = offlineDb(),
): Promise<SyncMetaValues[K] | undefined> {
	const row = await db.syncMeta.get(key);
	return row?.value as SyncMetaValues[K] | undefined;
}

export async function setMeta<K extends SyncMetaKey>(
	key: K,
	value: SyncMetaValues[K],
	db: StoryLensDatabase = offlineDb(),
): Promise<void> {
	await db.syncMeta.put({ key, value });
}

/**
 * Marks the store changed (and the given novels), inside the caller's
 * transaction when there is one. Views cached by change counter rebuild, and
 * tabs showing a changed novel refresh their highlights.
 */
export async function bumpChangeCounter(
	db: StoryLensDatabase,
	novelIds: (string | null | undefined)[] = [],
): Promise<void> {
	const counter = ((await getMeta("changeCounter", db)) ?? 0) + 1;
	await setMeta("changeCounter", counter, db);
	const ids = [...new Set(novelIds.filter((id): id is string => !!id))];
	if (!ids.length) return;
	const counters = { ...((await getMeta("novelCounters", db)) ?? {}) };
	for (const id of ids) counters[id] = (counters[id] ?? 0) + 1;
	await setMeta("novelCounters", counters, db);
}

// ---------------------------------------------------------------------------
// novelSync: pinned (downloaded) novels and pull bookkeeping
// ---------------------------------------------------------------------------

export async function getNovelSync(
	novelId: string,
	db: StoryLensDatabase = offlineDb(),
): Promise<NovelSync | undefined> {
	return db.novelSync.get(novelId);
}

async function patchNovelSync(
	db: StoryLensDatabase,
	novelId: string,
	changes: Partial<NovelSync>,
): Promise<void> {
	const existing = await db.novelSync.get(novelId);
	await db.novelSync.put({ novelId, pinned: 0, ...existing, ...changes });
}

export async function pinNovel(
	novelId: string,
	db: StoryLensDatabase = offlineDb(),
): Promise<void> {
	await patchNovelSync(db, novelId, { pinned: 1, downloadedAt: Date.now() });
}

export async function unpinNovel(
	novelId: string,
	db: StoryLensDatabase = offlineDb(),
): Promise<void> {
	await patchNovelSync(db, novelId, { pinned: 0, downloadedAt: undefined });
}

export async function listPinned(
	db: StoryLensDatabase = offlineDb(),
): Promise<NovelSync[]> {
	return db.novelSync.where("pinned").equals(1).toArray();
}

export async function markPulled(
	novelId: string,
	error?: string,
	db: StoryLensDatabase = offlineDb(),
	full = true,
): Promise<void> {
	const now = Date.now();
	await patchNovelSync(
		db,
		novelId,
		error
			? { lastPullError: error }
			: {
					lastPulledAt: now,
					lastPullError: undefined,
					refreshRequestedAt: undefined,
					pullDue: undefined,
					...(full ? { lastFullPullAt: now } : {}),
				},
	);
}

export async function markRemovedOnServer(
	novelId: string,
	db: StoryLensDatabase = offlineDb(),
): Promise<void> {
	await patchNovelSync(db, novelId, {
		removedOnServer: true,
		pullDue: undefined,
		refreshRequestedAt: undefined,
	});
}

/** Asks the runner for a fresher copy of a cached novel (stale-while-revalidate). */
export async function requestRefresh(
	novelId: string,
	db: StoryLensDatabase = offlineDb(),
): Promise<void> {
	await patchNovelSync(db, novelId, { refreshRequestedAt: Date.now() });
}

/** A push outcome changed server data this client did not send (chain rewrite, missing parent). */
export async function markPullDue(
	novelId: string,
	db: StoryLensDatabase = offlineDb(),
): Promise<void> {
	await patchNovelSync(db, novelId, { pullDue: true });
}

export async function setNovelCursor(
	novelId: string,
	cursor: number | undefined,
	db: StoryLensDatabase = offlineDb(),
): Promise<void> {
	await patchNovelSync(db, novelId, { cursor });
}
