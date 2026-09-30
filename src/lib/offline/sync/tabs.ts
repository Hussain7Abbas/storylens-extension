import { browser } from "#imports";
import type { currentNovelMeta } from "@/types";

/** Tab → detected novel, in session storage so it survives worker restarts (cleared with the browser). */
export const TAB_NOVELS_KEY = "storylens-tab-novels";
const REFRESH_INTERVAL_MS = 2_000;

export type TabNovel = currentNovelMeta & { novelId?: string };

type TabNovels = Record<string, TabNovel>;

const lastRefresh = new Map<number, number>();

async function readTabNovels(): Promise<TabNovels> {
	try {
		const stored = await browser.storage.session.get(TAB_NOVELS_KEY);
		return (stored[TAB_NOVELS_KEY] as TabNovels | undefined) ?? {};
	} catch {
		return {};
	}
}

async function writeTabNovels(value: TabNovels): Promise<void> {
	try {
		await browser.storage.session.set({ [TAB_NOVELS_KEY]: value });
	} catch {
		// Session storage unavailable; tabs are re-reported on their next page load.
	}
}

export async function setTabNovel(
	tabId: number,
	novel: TabNovel,
): Promise<void> {
	const all = await readTabNovels();
	const previous = all[String(tabId)];
	all[String(tabId)] = {
		...novel,
		novelId:
			novel.novelId ??
			(previous?.novelSlug === novel.novelSlug ? previous.novelId : undefined),
	};
	await writeTabNovels(all);
}

export async function getTabNovel(
	tabId: number,
): Promise<TabNovel | undefined> {
	return (await readTabNovels())[String(tabId)];
}

/** Records the novel ID a tab's slug resolved to, so refreshes find the tab. */
export async function setTabNovelId(
	novelSlug: string,
	novelId: string,
): Promise<void> {
	const all = await readTabNovels();
	let changed = false;
	for (const entry of Object.values(all)) {
		if (entry.novelSlug === novelSlug && entry.novelId !== novelId) {
			entry.novelId = novelId;
			changed = true;
		}
	}
	if (changed) await writeTabNovels(all);
}

export async function removeTabNovel(tabId: number): Promise<void> {
	const all = await readTabNovels();
	delete all[String(tabId)];
	lastRefresh.delete(tabId);
	await writeTabNovels(all);
}

/**
 * Asks every tab showing one of `novelIds` to re-run highlighting, at most once
 * every two seconds per tab. `send` delivers the `refreshContent` message.
 */
export async function refreshNovelTabs(
	novelIds: string[],
	send: (tabId: number, novelSlug: string) => Promise<unknown>,
	now = Date.now(),
): Promise<number[]> {
	if (!novelIds.length) return [];
	const wanted = new Set(novelIds);
	const refreshed: number[] = [];
	for (const [key, entry] of Object.entries(await readTabNovels())) {
		const tabId = Number(key);
		if (!entry.novelId || !wanted.has(entry.novelId)) continue;
		if (now - (lastRefresh.get(tabId) ?? 0) < REFRESH_INTERVAL_MS) continue;
		lastRefresh.set(tabId, now);
		try {
			await send(tabId, entry.novelSlug);
			refreshed.push(tabId);
		} catch {
			// The tab navigated away or has no content script.
		}
	}
	return refreshed;
}

export function resetTabRefreshThrottleForTests(): void {
	lastRefresh.clear();
}
