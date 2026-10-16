import { browser } from "#imports";
import { getStoredAuth } from "@/lib/auth/auth-storage";
import { AI_PRICING_KEY, type PricingCache } from "@/lib/billing/cache";
import { desktopSettings } from "../desktop-client/settings";
import { aiAvailability } from "./availability";
import {
	AI_IMAGE_SOURCE_KEY,
	AI_SOURCE_KEY,
	type AiFeature,
	type AiSource,
	featureAiSource,
} from "./source";
export async function aiState(feature: AiFeature) {
	const [desktop, auth, stored] = await Promise.all([
		desktopSettings(),
		getStoredAuth(),
		browser.storage.local.get([
			AI_SOURCE_KEY,
			AI_IMAGE_SOURCE_KEY,
			AI_PRICING_KEY,
		]),
	]);
	const source = featureAiSource(
		feature,
		stored[AI_SOURCE_KEY],
		stored[AI_IMAGE_SOURCE_KEY],
		desktop,
	);
	const pricing =
		(stored[AI_PRICING_KEY] as PricingCache | undefined)?.data ?? null;
	return {
		source,
		desktop,
		user: auth.user,
		pricing,
		availability: aiAvailability({
			source,
			desktop,
			user: auth.user,
			pricing,
			feature,
		}),
	};
}

/** Freeze the legacy image choice when the text source first changes. */
export async function saveAiSource(
	source: AiSource,
	feature: "text" | "image",
): Promise<void> {
	if (feature === "image") {
		await browser.storage.local.set({ [AI_IMAGE_SOURCE_KEY]: source });
		return;
	}
	const current = await aiState("character_image");
	await browser.storage.local.set({
		[AI_SOURCE_KEY]: source,
		[AI_IMAGE_SOURCE_KEY]: current.source,
	});
}
