import type { AxiosRequestConfig } from "axios";
import { customInstance } from "@/api/axios-instance";
import {
	getSyncCatalogueChanges,
	getSyncLookupsChanges,
	getSyncNovelsByIdChanges,
} from "@/api/generated/endpoints/sync";
import type { StoryLensDatabase } from "@/lib/offline/db";
import {
	getMeta,
	listPinned,
	markPulled,
	markRemovedOnServer,
	setMeta,
} from "@/lib/offline/meta";
import {
	applyCatalogueDelta,
	applyLookupsDelta,
	applyNovelDelta,
	markNovelMutationsDeleted,
	type NovelDeltaPage,
	replaceCatalogue,
	replaceLookups,
	replaceNovelSnapshot,
} from "@/lib/offline/snapshot";
import type {
	AssembledKeyword,
	BiasRow,
	CatalogNovel,
	CategoryRow,
	NatureRow,
	NovelSync,
	ReplacementRow,
} from "@/lib/offline/types";
import { REQUEST_TIMEOUT_MS } from "./transport";

/** Pinned novels, cached novels and the lookups refresh after this long. */
export const NOVEL_STALE_MS = 10 * 60 * 1000;
export const LOOKUPS_STALE_MS = 10 * 60 * 1000;
export const CATALOGUE_STALE_MS = 30 * 60 * 1000;
/** Delta-refreshed units are pulled in full once a week to reconcile. */
export const RECONCILE_MS = 7 * 24 * 60 * 60 * 1000;

/** Reads that write nothing (online-only mode when IndexedDB is unavailable). */
export type FetchContext = { token?: string; signal?: AbortSignal };

export type PullContext = {
	db: StoryLensDatabase;
	token: string;
	signal?: AbortSignal;
	now?: number;
};

function request(ctx: FetchContext): AxiosRequestConfig {
	return {
		timeout: REQUEST_TIMEOUT_MS,
		signal: ctx.signal,
		headers: {
			...(ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}),
		},
	};
}

function statusOf(error: unknown): number | undefined {
	return (error as { response?: { status?: number } })?.response?.status;
}

// ---------------------------------------------------------------------------
// Full pulls
// ---------------------------------------------------------------------------

type CatalogueSnapshot = { novels: CatalogNovel[]; cursor: number };
type LookupsSnapshot = {
	categories: CategoryRow[];
	natures: NatureRow[];
	cursor: number;
};
type NovelSnapshot = {
	novel: CatalogNovel;
	keywords: AssembledKeyword[];
	replacements: ReplacementRow[];
	biases: BiasRow[];
	cursor: number;
};

async function snapshot<T>(path: string, ctx: FetchContext): Promise<T> {
	return (
		await customInstance<T>(
			{ url: `/api/user/sync/snapshot/${path}`, method: "GET" },
			request(ctx),
		)
	).data;
}

export async function fetchNovels(ctx: FetchContext): Promise<CatalogNovel[]> {
	return (await snapshot<CatalogueSnapshot>("catalogue", ctx)).novels;
}

export async function fetchLookups(
	ctx: FetchContext,
): Promise<{ categories: CategoryRow[]; natures: NatureRow[] }> {
	const { categories, natures } = await snapshot<LookupsSnapshot>(
		"lookups",
		ctx,
	);
	return { categories, natures };
}

/** All novels in one server snapshot; the cursor describes those same rows. */
export async function pullCatalogue(ctx: PullContext): Promise<void> {
	const { novels, cursor } = await snapshot<CatalogueSnapshot>(
		"catalogue",
		ctx,
	);
	await replaceCatalogue(novels, ctx.db);
	await setMeta("catalogueCursor", cursor, ctx.db);
	await setMeta("catalogFullPullAt", ctx.now ?? Date.now(), ctx.db);
}

/** Categories and natures from one server snapshot. */
export async function pullLookups(ctx: PullContext): Promise<void> {
	const { cursor, ...lookups } = await snapshot<LookupsSnapshot>(
		"lookups",
		ctx,
	);
	await replaceLookups(lookups, ctx.db);
	await setMeta("lookupsCursor", cursor, ctx.db);
	await setMeta("lookupsFullPullAt", ctx.now ?? Date.now(), ctx.db);
}

/** A novel and every related row from one server snapshot. */
export async function fetchNovelBundle(
	novelId: string,
	ctx: FetchContext,
): Promise<NovelSnapshot> {
	return snapshot<NovelSnapshot>(`novels/${novelId}`, ctx);
}

export async function pullNovel(
	novelId: string,
	ctx: PullContext,
): Promise<"pulled" | "removed"> {
	let bundle: NovelSnapshot;
	try {
		bundle = await fetchNovelBundle(novelId, ctx);
	} catch (error) {
		if (statusOf(error) !== 404) throw error;
		await ctx.db.transaction(
			"rw",
			[ctx.db.novelSync, ctx.db.mutations, ctx.db.syncMeta],
			async () => {
				await markRemovedOnServer(novelId, ctx.db);
				await markNovelMutationsDeleted(ctx.db, novelId);
			},
		);
		return "removed";
	}
	await replaceNovelSnapshot(novelId, bundle, ctx.db);
	await ctx.db.transaction("rw", ctx.db.novelSync, async () => {
		await markPulled(novelId, undefined, ctx.db);
		const sync = await ctx.db.novelSync.get(novelId);
		if (sync)
			await ctx.db.novelSync.put({
				...sync,
				cursor: bundle.cursor,
				removedOnServer: undefined,
			});
	});
	return "pulled";
}

/** A version create also closes its predecessor; refresh the whole novel atomically. */
export async function refreshKeywordVersions(
	keywordId: string,
	ctx: PullContext,
): Promise<void> {
	const keyword = await ctx.db.keywords.get(keywordId);
	if (keyword) await pullNovel(keyword.novelId, ctx);
}

// ---------------------------------------------------------------------------
// Delta pulls (phase 9)
// ---------------------------------------------------------------------------

class CursorExpired extends Error {}

async function readPages<T extends { cursor: number; hasMore: boolean }>(
	since: number,
	fetch: (since: number) => Promise<T>,
	apply: (page: T) => Promise<void>,
): Promise<void> {
	let cursor = since;
	for (let guard = 0; guard < 1000; guard++) {
		let page: T;
		try {
			page = await fetch(cursor);
		} catch (error) {
			if (statusOf(error) === 410) throw new CursorExpired();
			throw error;
		}
		if (typeof page?.cursor !== "number") throw new CursorExpired();
		await apply(page);
		if (!page.hasMore || page.cursor <= cursor) return;
		cursor = page.cursor;
	}
}

/** Delta refresh of a novel from its cursor; false when a full pull is needed. */
async function deltaNovel(
	novelId: string,
	cursor: number,
	ctx: PullContext,
): Promise<boolean> {
	try {
		await readPages(
			cursor,
			async (since) =>
				(await getSyncNovelsByIdChanges(novelId, { since }, request(ctx)))
					.data as unknown as NovelDeltaPage & { hasMore: boolean },
			(page) => applyNovelDelta(novelId, page, ctx.db),
		);
		return true;
	} catch (error) {
		if (error instanceof CursorExpired) return false;
		throw error;
	}
}

async function deltaLookups(
	cursor: number,
	ctx: PullContext,
): Promise<boolean> {
	try {
		await readPages(
			cursor,
			async (since) =>
				(await getSyncLookupsChanges({ since }, request(ctx)))
					.data as unknown as Parameters<typeof applyLookupsDelta>[0] & {
					hasMore: boolean;
				},
			(page) => applyLookupsDelta(page, ctx.db),
		);
		return true;
	} catch (error) {
		if (error instanceof CursorExpired) return false;
		throw error;
	}
}

async function deltaCatalogue(
	cursor: number,
	ctx: PullContext,
): Promise<boolean> {
	try {
		await readPages(
			cursor,
			async (since) =>
				(await getSyncCatalogueChanges({ since }, request(ctx)))
					.data as unknown as Parameters<typeof applyCatalogueDelta>[0] & {
					hasMore: boolean;
				},
			(page) => applyCatalogueDelta(page, ctx.db),
		);
		return true;
	} catch (error) {
		if (error instanceof CursorExpired) return false;
		throw error;
	}
}

/** A novel refresh: a delta pull from its cursor when possible, else a full pull. */
export async function refreshNovel(
	novelId: string,
	ctx: PullContext,
): Promise<"pulled" | "removed"> {
	const now = ctx.now ?? Date.now();
	const sync = await ctx.db.novelSync.get(novelId);
	const reconciled = now - (sync?.lastFullPullAt ?? 0) < RECONCILE_MS;
	if (
		sync?.cursor !== undefined &&
		sync.lastPulledAt &&
		reconciled &&
		(await deltaNovel(novelId, sync.cursor, ctx))
	) {
		return (await ctx.db.novelSync.get(novelId))?.removedOnServer
			? "removed"
			: "pulled";
	}
	return pullNovel(novelId, ctx);
}

export async function refreshLookups(ctx: PullContext): Promise<void> {
	const now = ctx.now ?? Date.now();
	const [cursor, fullAt] = await Promise.all([
		getMeta("lookupsCursor", ctx.db),
		getMeta("lookupsFullPullAt", ctx.db),
	]);
	if (
		cursor !== undefined &&
		now - (fullAt ?? 0) < RECONCILE_MS &&
		(await deltaLookups(cursor, ctx))
	)
		return;
	await pullLookups(ctx);
}

export async function refreshCatalogue(ctx: PullContext): Promise<void> {
	const now = ctx.now ?? Date.now();
	const [cursor, fullAt] = await Promise.all([
		getMeta("catalogueCursor", ctx.db),
		getMeta("catalogFullPullAt", ctx.db),
	]);
	if (
		cursor !== undefined &&
		now - (fullAt ?? 0) < RECONCILE_MS &&
		(await deltaCatalogue(cursor, ctx))
	)
		return;
	await pullCatalogue(ctx);
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export type PullMode = "stale" | "all" | "none";

export type PullSummary = {
	pulledUnits: number;
	failedUnits: number;
	changedNovels: string[];
};

/**
 * Pulls the units that are due: lookups and pinned novels older than 10 minutes
 * (all of them on Sync now), cached novels a page or the popup asked for,
 * novels a push outcome marked, and the catalogue on popup open when older than
 * 30 minutes. A failing unit records its error and never stops the others.
 */
export async function pullDueUnits(
	ctx: PullContext,
	{
		mode = "stale",
		reason,
		deadline = Number.POSITIVE_INFINITY,
		forceCatalogue = false,
	}: {
		mode?: PullMode;
		reason?: string;
		deadline?: number;
		forceCatalogue?: boolean;
	} = {},
): Promise<PullSummary> {
	const summary: PullSummary = {
		pulledUnits: 0,
		failedUnits: 0,
		changedNovels: [],
	};
	if (mode === "none") return summary;
	const now = ctx.now ?? Date.now();
	const all = mode === "all";
	const run = async (
		unit: () => Promise<unknown>,
		onError?: (message: string) => Promise<void>,
	) => {
		if (Date.now() > deadline || ctx.signal?.aborted) return;
		try {
			await unit();
			summary.pulledUnits += 1;
		} catch (error) {
			summary.failedUnits += 1;
			const message = error instanceof Error ? error.message : String(error);
			console.warn("[StoryLens] Pull failed", message);
			await onError?.(message);
		}
	};

	const catalogPulledAt = (await getMeta("catalogPulledAt", ctx.db)) ?? 0;
	if (
		forceCatalogue ||
		((all || reason === "popup-open" || !catalogPulledAt) &&
			now - catalogPulledAt > (all ? 0 : CATALOGUE_STALE_MS))
	) {
		await run(() => refreshCatalogue(ctx));
	}
	const lookupsPulledAt = (await getMeta("lookupsPulledAt", ctx.db)) ?? 0;
	if (all || now - lookupsPulledAt > LOOKUPS_STALE_MS)
		await run(() => refreshLookups(ctx));

	const pinned = await listPinned(ctx.db);
	const requested = await ctx.db.novelSync
		.filter(
			(sync: NovelSync) =>
				!sync.pinned && (!!sync.pullDue || !!sync.refreshRequestedAt),
		)
		.toArray();
	for (const sync of [...pinned, ...requested]) {
		if (sync.removedOnServer) continue;
		const stale = now - (sync.lastPulledAt ?? 0) > NOVEL_STALE_MS;
		const due =
			!!sync.pullDue ||
			!!sync.refreshRequestedAt ||
			(sync.pinned ? all || stale : stale);
		if (!due) {
			if (sync.refreshRequestedAt)
				await ctx.db.novelSync.update(sync.novelId, {
					refreshRequestedAt: undefined,
				});
			continue;
		}
		await run(
			async () => {
				await refreshNovel(sync.novelId, ctx);
				summary.changedNovels.push(sync.novelId);
			},
			(message) => markPulled(sync.novelId, message, ctx.db),
		);
	}
	if (summary.pulledUnits && !summary.failedUnits)
		await setMeta("lastPullAt", Date.now(), ctx.db);
	return summary;
}
