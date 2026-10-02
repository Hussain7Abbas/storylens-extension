import { browser } from "#imports";
import { getStoredAuth } from "@/lib/auth/auth-storage";
import { AI_PRICING_KEY, type PricingCache } from "@/lib/billing/cache";
import { desktopSettings } from "../desktop-client/settings";
import { aiAvailability } from "./availability";
import { AI_SOURCE_KEY, type AiFeature, parseAiSource } from "./source";
export async function aiState(feature: AiFeature) {
	const [desktop, auth, stored] = await Promise.all([
		desktopSettings(),
		getStoredAuth(),
		browser.storage.local.get([AI_SOURCE_KEY, AI_PRICING_KEY]),
	]);
	const source = parseAiSource(stored[AI_SOURCE_KEY], desktop);
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
