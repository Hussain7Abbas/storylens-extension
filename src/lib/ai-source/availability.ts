import type { GetBillingPricing200 } from "@/api/generated/schemas";
import { isAiConfigured } from "../desktop-client/ai-config";
import type { DesktopSettings } from "../desktop-client/types";
import type { AiFeature, AiSource } from "./source";

export type AiUnavailableReason =
	| "desktop-unpaired"
	| "signed-out"
	| "guest"
	| "cloud-off"
	| "feature-off";
export type AiAvailability =
	| { ok: true }
	| { ok: false; reason: AiUnavailableReason };
export function aiAvailability(input: {
	source: AiSource;
	desktop: DesktopSettings;
	user: { isGuest: boolean } | null;
	pricing: GetBillingPricing200 | null;
	feature: AiFeature;
}): AiAvailability {
	if (input.source === "desktop")
		return isAiConfigured(input.desktop)
			? { ok: true }
			: { ok: false, reason: "desktop-unpaired" };
	if (!input.user) return { ok: false, reason: "signed-out" };
	if (input.user.isGuest) return { ok: false, reason: "guest" };
	if (!input.pricing?.cloudAi.enabled)
		return { ok: false, reason: "cloud-off" };
	const price = input.pricing.features.find(
		(price) => price.key === input.feature,
	);
	return price?.enabled ? { ok: true } : { ok: false, reason: "feature-off" };
}
export function availabilityKey(value: AiAvailability): string {
	return value.ok
		? ""
		: value.reason === "desktop-unpaired"
			? "desktop.configureAi"
			: `cloud.${value.reason}`;
}
