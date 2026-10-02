import type {
	GetBillingBalance200NoticesItem,
	GetBillingPricing200,
} from "@/api/generated/schemas";
export const AI_PRICING_KEY = "storylens-ai-pricing";
export const LENS_BALANCE_KEY = "storylens-lens-balance";
export const LENS_NOTICES_KEY = "storylens-lens-notices";
export type PricingCache = { data: GetBillingPricing200; fetchedAt: number };
export type BalanceCache = {
	userId: string;
	balance: number;
	updatedAt: number;
};
export type NoticeCache = {
	userId: string;
	notices: GetBillingBalance200NoticesItem[];
};
export function cacheFresh(
	cache: { fetchedAt: number } | null | undefined,
	maxAge: number,
	now = Date.now(),
): boolean {
	return !!cache && now >= cache.fetchedAt && now - cache.fetchedAt < maxAge;
}
export function accountBalance(
	cache: BalanceCache | null | undefined,
	userId: string | undefined,
): number | null {
	return cache && cache.userId === userId ? cache.balance : null;
}
