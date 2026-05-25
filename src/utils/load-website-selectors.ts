import { browser } from "#imports";
import { getWebsiteSelectorsByWebsite } from "@/api/generated/endpoints/website-selectors.js";
import type { websiteSelector } from "@/types/configs";

function getCacheKey(website: string): string {
	return `storylens-website-selector-cache:${website}`;
}

export async function cacheWebsiteSelector(
	website: string,
	selector: websiteSelector,
): Promise<void> {
	await browser.storage.local.set({ [getCacheKey(website)]: selector });
}

export async function getCachedWebsiteSelector(
	website: string,
): Promise<websiteSelector | undefined> {
	const result = await browser.storage.local.get(getCacheKey(website));
	const cached = result[getCacheKey(website)];

	if (!cached || typeof cached !== "object") {
		return undefined;
	}

	return cached as websiteSelector;
}

function toWebsiteSelector(data: {
	website: string;
	novel: websiteSelector["novel"];
	chapter: websiteSelector["chapter"];
}): websiteSelector {
	return {
		website: data.website,
		novel: data.novel,
		chapter: data.chapter,
	};
}

export async function loadWebsiteSelector(
	website: string,
): Promise<websiteSelector | undefined> {
	const cached = await getCachedWebsiteSelector(website);
	if (cached) {
		return cached;
	}

	try {
		const response = await getWebsiteSelectorsByWebsite(website);
		const selector = toWebsiteSelector(response.data);
		await cacheWebsiteSelector(website, selector);
		return selector;
	} catch (error) {
		console.error(
			"Failed to load website selector from API, using cache",
			error,
		);
		return undefined;
	}
}

export type WebsiteSelectorRefreshResult = {
	selector: websiteSelector | undefined;
	changed: boolean;
};

export async function refreshWebsiteSelectorFromApi(
	website: string,
): Promise<WebsiteSelectorRefreshResult> {
	const cached = await getCachedWebsiteSelector(website);

	try {
		const response = await getWebsiteSelectorsByWebsite(website);
		const selector = toWebsiteSelector(response.data);

		if (JSON.stringify(selector) === JSON.stringify(cached)) {
			return { selector, changed: false };
		}

		await cacheWebsiteSelector(website, selector);
		return { selector, changed: true };
	} catch (error) {
		console.error("Failed to refresh website selector from API", error);
		return { selector: cached, changed: false };
	}
}
