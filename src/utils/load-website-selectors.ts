import { browser } from "#imports";
import { getConfigsByKey } from "@/api/endpoints/configs.js";
import { WEBSITES_SELECTORS_KEY } from "@/components/node-selector/constants";

const WEBSITE_SELECTORS_CACHE_KEY = "storylens-website-selectors-cache";

export async function cacheWebsiteSelectorsValue(value: string): Promise<void> {
	await browser.storage.local.set({ [WEBSITE_SELECTORS_CACHE_KEY]: value });
}

export async function getCachedWebsiteSelectorsValue(): Promise<
	string | undefined
> {
	const result = await browser.storage.local.get(WEBSITE_SELECTORS_CACHE_KEY);
	const cached = result[WEBSITE_SELECTORS_CACHE_KEY];
	return typeof cached === "string" && cached.length > 0 ? cached : undefined;
}

export async function loadWebsiteSelectorsValue(): Promise<string | undefined> {
	const cached = await getCachedWebsiteSelectorsValue();
	if (cached) {
		return cached;
	}

	try {
		const response = await getConfigsByKey(WEBSITES_SELECTORS_KEY);
		const value = response.data.value;
		if (value) {
			await cacheWebsiteSelectorsValue(value);
		}
		return value;
	} catch (error) {
		console.error(
			"Failed to load website selectors from API, using cache",
			error,
		);
		return undefined;
	}
}

export type WebsiteSelectorsRefreshResult = {
	value: string | undefined;
	changed: boolean;
};

export async function refreshWebsiteSelectorsFromApi(): Promise<WebsiteSelectorsRefreshResult> {
	const cached = await getCachedWebsiteSelectorsValue();

	try {
		const response = await getConfigsByKey(WEBSITES_SELECTORS_KEY);
		const value = response.data.value;

		if (!value) {
			return { value: cached, changed: false };
		}

		if (value === cached) {
			return { value, changed: false };
		}

		await cacheWebsiteSelectorsValue(value);
		return { value, changed: true };
	} catch (error) {
		console.error("Failed to refresh website selectors from API", error);
		return { value: cached, changed: false };
	}
}
