import type { currentNovelMeta } from "@/types";
import type { websiteSelector, websiteSelectors } from "@/types/configs";
import {
	extractFromXpath,
	extractNovelNameFromXpath,
} from "@/utils/novel-title";

/**
 * Detects the site name based on the xpath or url
 */
export function getSiteName(): string {
	return window?.location?.hostname || "local";
}

/**
 * Extracts novel slug from URL (preferred) or xpath fallback
 */
export function getNovelSlug(
	websiteSelector: websiteSelector,
	document: Document,
): string | null {
	if (websiteSelector.novel?.url?.regex) {
		const fromUrl = extractFromUrl(
			document.location.href,
			websiteSelector.novel.url.regex,
		);
		if (fromUrl) {
			return fromUrl;
		}
	}

	if (websiteSelector.novel?.xpath?.value) {
		const fromXpath = extractFromXpath(
			websiteSelector.novel.xpath.value,
			websiteSelector.novel.xpath.regex || ".*",
			document,
		);
		if (fromXpath) {
			return fromXpath;
		}
	}

	return null;
}

/**
 * Extracts human-readable novel name from xpath
 */
export function getNovelName(
	websiteSelector: websiteSelector,
	document: Document,
): string | null {
	if (!websiteSelector.novel?.xpath?.value) {
		return null;
	}

	return extractNovelNameFromXpath(
		websiteSelector.novel.xpath.value,
		websiteSelector.novel.xpath.regex || ".*",
		document,
	);
}

/**
 * Checks if the current page is a novel chapter page
 */
export function getChapterNumber(
	websiteSelector: websiteSelector,
	document: Document,
): number | null {
	if (websiteSelector.chapter?.xpath?.value) {
		const fromXpath = extractFromXpath(
			websiteSelector.chapter.xpath.value,
			websiteSelector.chapter.xpath.regex || "\\d+",
			document,
		);
		if (fromXpath) {
			const chapter = Number.parseInt(fromXpath, 10);
			if (!Number.isNaN(chapter) && chapter > 0) {
				return chapter;
			}
		}
	}

	if (websiteSelector.chapter?.url?.regex) {
		const fromUrl = extractFromUrl(
			document.location.href,
			websiteSelector.chapter.url.regex,
		);
		if (fromUrl) {
			const chapter = Number.parseInt(fromUrl, 10);
			if (!Number.isNaN(chapter) && chapter > 0) {
				return chapter;
			}
		}
	}

	return null;
}

/**
 * Extracts text from a url
 */
export function extractFromUrl(url: string, regex: string): string | null {
	const match = url.match(regex);
	return match ? match[1] : null;
}

export function getWebsiteSelector(
	websiteSelectorData: string | undefined,
	website: string | undefined,
): websiteSelector | undefined {
	if (!websiteSelectorData || !website) {
		return undefined;
	}

	try {
		const selectors = JSON.parse(websiteSelectorData) as websiteSelectors;
		const selector = selectors[website];
		if (!selector || Object.keys(selector).length === 0) {
			return undefined;
		}
		return selector;
	} catch {
		return undefined;
	}
}

export function getAllNovelData(
	websiteSelectorData: string | undefined,
	website: string | undefined,
	document: Document,
): currentNovelMeta | undefined {
	const websiteSelector = getWebsiteSelector(websiteSelectorData, website);
	if (!websiteSelector) {
		console.log(
			"[StoryLens] Not a supported website selector, skipping content processing",
		);
		return undefined;
	}

	const novelSlug = getNovelSlug(websiteSelector, document);
	if (!novelSlug) {
		console.log("[StoryLens] Not a novel page, skipping content processing");
		return undefined;
	}

	const chapter = getChapterNumber(websiteSelector, document);
	const novelName = getNovelName(websiteSelector, document);

	const meta = {
		novelSlug,
		...(novelName ? { novelName } : {}),
		...(chapter !== null ? { chapter } : {}),
	};

	console.log("[StoryLens] Extracted novel metadata from page", meta);
	return meta;
}
