import { browser } from "#imports";
import {
	getBillingBalance,
	getBillingPricing,
	postBillingNoticesSeen,
} from "@/api/generated/endpoints/billing";
import { getStoredAuth } from "@/lib/auth/auth-storage";
import {
	AI_PRICING_KEY,
	cacheFresh,
	LENS_BALANCE_KEY,
	LENS_NOTICES_KEY,
	type NoticeCache,
	type PricingCache,
} from "./cache";

let pricingRefresh: Promise<void> | undefined;
export async function refreshAiPricing(maxAge = 10 * 60_000): Promise<void> {
	if (pricingRefresh) return pricingRefresh;
	const cached = (await browser.storage.local.get(AI_PRICING_KEY))[
		AI_PRICING_KEY
	] as PricingCache | undefined;
	if (cacheFresh(cached, maxAge)) return;
	pricingRefresh = (async () => {
		try {
			const { data } = await getBillingPricing();
			await browser.storage.local.set({
				[AI_PRICING_KEY]: { data, fetchedAt: Date.now() },
			});
		} catch {
			/* Last successful prices remain usable while offline. */
		}
	})();
	try {
		await pricingRefresh;
	} finally {
		pricingRefresh = undefined;
	}
}
/** Account checks after the request prevent a late response from replacing another account's balance. */
export async function refreshLensBalance(): Promise<void> {
	const auth = await getStoredAuth();
	if (!auth.user || auth.user.isGuest || !auth.token) {
		await browser.storage.local.remove([LENS_BALANCE_KEY, LENS_NOTICES_KEY]);
		return;
	}
	try {
		const { data } = await getBillingBalance({ surface: "extension" });
		const now = await getStoredAuth();
		if (now.user?.id !== auth.user.id || now.token !== auth.token) return;
		await browser.storage.local.set({
			[LENS_BALANCE_KEY]: {
				userId: auth.user.id,
				balance: data.balance,
				updatedAt: Date.now(),
			},
			[LENS_NOTICES_KEY]: { userId: auth.user.id, notices: data.notices },
		});
	} catch {
		/* Keep the account's last known balance. */
	}
}
export async function updateFrameBalance(
	userId: string,
	balance: number,
): Promise<void> {
	if (
		!Number.isSafeInteger(balance) ||
		balance < 0 ||
		(await getStoredAuth()).user?.id !== userId
	)
		return;
	await browser.storage.local.set({
		[LENS_BALANCE_KEY]: { userId, balance, updatedAt: Date.now() },
	});
}
export async function markLensNoticesSeen(data: {
	userId: string;
	ids: string[];
}): Promise<boolean> {
	if ((await getStoredAuth()).user?.id !== data.userId) return false;
	try {
		await postBillingNoticesSeen({ ids: data.ids, surface: "extension" });
		const held = (await browser.storage.local.get(LENS_NOTICES_KEY))[
			LENS_NOTICES_KEY
		] as NoticeCache | undefined;
		if (held?.userId === data.userId)
			await browser.storage.local.set({
				[LENS_NOTICES_KEY]: {
					...held,
					notices: held.notices.filter(
						(notice) => !data.ids.includes(notice.id),
					),
				},
			});
		return true;
	} catch {
		return false;
	}
}
/** A short lease prevents toolbar and kept launcher popups celebrating the same notice together. */
export async function claimLensNotices(data: {
	userId: string;
	ids: string[];
}): Promise<string[]> {
	return navigator.locks.request("storylens-lens-notice-claim", async () => {
		if ((await getStoredAuth()).user?.id !== data.userId) return [];
		const key = "storylens-lens-notice-claims";
		const stored = (await browser.storage.session.get(key))[key] as
			| { userId: string; leases: Record<string, number> }
			| undefined;
		const now = Date.now();
		const leases: Record<string, number> =
			stored?.userId === data.userId ? { ...stored.leases } : {};
		const granted = data.ids.filter((id) => !leases[id] || leases[id] < now);
		for (const id of granted) leases[id] = now + 30_000;
		for (const id of Object.keys(leases))
			if (leases[id] < now) delete leases[id];
		await browser.storage.session.set({
			[key]: { userId: data.userId, leases },
		});
		return granted;
	});
}
