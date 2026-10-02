import { atom, useAtomValue } from "jotai";
import { useMemo } from "react";
import { browser } from "#imports";
import { sendMessage } from "@/entrypoints/background/messaging";
import { AUTH_STORAGE_KEY, parseStoredAuth } from "@/lib/auth/auth-storage";
import {
	AI_PRICING_KEY,
	accountBalance,
	type BalanceCache,
	LENS_BALANCE_KEY,
	LENS_NOTICES_KEY,
	type NoticeCache,
	type PricingCache,
} from "@/lib/billing/cache";
import { parseDesktopSettings } from "../desktop-client/settings";
import { DESKTOP_SETTINGS_KEY } from "../desktop-client/types";
import { aiAvailability } from "./availability";
import { AI_SOURCE_KEY, type AiFeature, parseAiSource } from "./source";

const keys = [
	AI_SOURCE_KEY,
	DESKTOP_SETTINGS_KEY,
	AUTH_STORAGE_KEY,
	AI_PRICING_KEY,
	LENS_BALANCE_KEY,
	LENS_NOTICES_KEY,
];
const snapshotAtom = atom<Record<string, unknown>>({});
snapshotAtom.onMount = (set) => {
	let active = true,
		revision = 0;
	const read = async () => {
		const current = ++revision;
		const stored = await browser.storage.local.get(keys);
		if (active && current === revision) set({ ...stored, __loaded: true });
	};
	void read();
	void sendMessage("refreshAiBilling").catch(() => {});
	const change: Parameters<typeof browser.storage.onChanged.addListener>[0] = (
		changes,
		area,
	) => {
		if (area === "local" && keys.some((key) => key in changes)) void read();
	};
	browser.storage.onChanged.addListener(change);
	return () => {
		active = false;
		browser.storage.onChanged.removeListener(change);
	};
};
export function useAiSnapshot() {
	const stored = useAtomValue(snapshotAtom);
	const desktop = parseDesktopSettings(stored[DESKTOP_SETTINGS_KEY]);
	const source = parseAiSource(stored[AI_SOURCE_KEY], desktop);
	const authRaw = stored[AUTH_STORAGE_KEY];
	const auth = useMemo(() => parseStoredAuth(authRaw), [authRaw]);
	const pricing =
		(stored[AI_PRICING_KEY] as PricingCache | undefined)?.data ?? null;
	const balance = accountBalance(
		stored[LENS_BALANCE_KEY] as BalanceCache | undefined,
		auth.user?.id,
	);
	const notices = stored[LENS_NOTICES_KEY] as NoticeCache | undefined;
	return {
		loaded: stored.__loaded === true,
		source,
		desktop,
		user: auth.user,
		pricing,
		balance,
		notices: notices && notices.userId === auth.user?.id ? notices.notices : [],
	};
}
export function useAiAvailability(feature: AiFeature) {
	return aiAvailability({ ...useAiSnapshot(), feature });
}
export function useAiPricing() {
	return useAiSnapshot().pricing;
}
export function useFeaturePrice(feature: AiFeature) {
	return (
		useAiSnapshot().pricing?.features.find((row) => row.key === feature)
			?.lenses ?? null
	);
}
export function useLensBalance() {
	return useAiSnapshot().balance;
}
