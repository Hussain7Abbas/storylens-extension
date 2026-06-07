import { browser, type ContentScriptContext } from "#imports";
import { onMessage, sendMessage } from "@/entrypoints/background/messaging";
import type { currentNovelMeta } from "@/types";
import type { websiteSelector as WebsiteSelector } from "@/types/configs";
import { removeExtensionMarkup } from "@/utils/content-processor";
import {
	setTooltipFontFace,
	setTooltipFontSize,
	setTooltipLocale,
} from "@/utils/keyword-tooltip";
import { processDetectedNovel } from "@/utils/process-detected-novel";
import { sanitizePageHtml } from "@/utils/sanitize-page-html";
import { getAllNovelData } from "@/utils/site-detection";

const LOG_PREFIX = "[StoryLens]";

let websiteSelector: WebsiteSelector | undefined;
let lastProcessedKey: string | undefined;

function buildDetectedNovelKey(meta: currentNovelMeta): string {
	return `${meta.novelSlug}:${meta.chapter ?? "unknown"}`;
}

async function loadWebsiteSelector(): Promise<void> {
	const website = window.location.hostname;
	if (!website) {
		websiteSelector = undefined;
		return;
	}

	try {
		websiteSelector = await sendMessage("getWebsiteSelector", website);
		console.log(`${LOG_PREFIX} Website selector loaded`, {
			website,
			hasSelector: !!websiteSelector,
		});
	} catch (error) {
		console.error(`${LOG_PREFIX} Failed to load website selector`, error);
		websiteSelector = undefined;
	}
}

function detectCurrentNovel(): currentNovelMeta | undefined {
	const novel = getAllNovelData(websiteSelector, document);
	if (!novel) {
		console.log(`${LOG_PREFIX} No novel detected on page`, {
			website: window.location.hostname,
			url: window.location.href,
		});
		return undefined;
	}

	console.log(`${LOG_PREFIX} Detected novel on page`, novel);
	return novel;
}

async function reportCurrentNovel(): Promise<void> {
	const novel = detectCurrentNovel();
	if (!novel) {
		return;
	}

	try {
		await sendMessage("reportCurrentNovel", novel);
		console.log(`${LOG_PREFIX} Reported current novel to background`, novel);
	} catch (error) {
		console.error(`${LOG_PREFIX} Failed to report current novel`, error);
	}
}

async function handleDetectedNovel(force = false): Promise<void> {
	const novel = detectCurrentNovel();
	if (!novel) {
		return;
	}

	const processKey = buildDetectedNovelKey(novel);
	if (!force && lastProcessedKey === processKey) {
		console.log(`${LOG_PREFIX} Novel already processed in this session`, novel);
		return;
	}

	await processDetectedNovel(novel, { force });
	lastProcessedKey = processKey;
}

export async function refreshPageContent(): Promise<void> {
	console.log(`${LOG_PREFIX} Refreshing content processing`);

	removeExtensionMarkup();
	lastProcessedKey = undefined;

	const novel = detectCurrentNovel();
	if (!novel) {
		console.warn(`${LOG_PREFIX} Refresh skipped: no novel detected on page`);
		return;
	}

	await processDetectedNovel(novel, { force: true });
	lastProcessedKey = buildDetectedNovelKey(novel);
}

export async function runContentScript(
	ctx: ContentScriptContext,
): Promise<void> {
	onMessage("websiteSelectorUpdated", ({ data }) => {
		if (data.website !== window.location.hostname) {
			return;
		}

		websiteSelector = data.selector;
		console.log(`${LOG_PREFIX} Website selector updated from background`, {
			website: data.website,
			hasSelector: !!websiteSelector,
		});
		lastProcessedKey = undefined;

		void reportCurrentNovel()
			.then(() => handleDetectedNovel(true))
			.catch((error) => {
				console.error(
					`${LOG_PREFIX} Failed to re-run detection after selector update`,
					error,
				);
			});
	});

	onMessage("refreshContent", () => {
		void refreshPageContent().catch((error) => {
			console.error(
				`${LOG_PREFIX} Failed to refresh content processing`,
				error,
			);
		});
	});

	onMessage("getPageHtml", () => {
		return {
			url: window.location.href,
			html: sanitizePageHtml(),
		};
	});

	onMessage("getCurrentNovel", async () => {
		if (!websiteSelector) {
			await loadWebsiteSelector();
		}

		return detectCurrentNovel();
	});

	const stored = await browser.storage.local.get([
		"storylens-locale",
		"storylens-font-face",
		"storylens-font-size",
	]);
	if (typeof stored["storylens-locale"] === "string") {
		setTooltipLocale(stored["storylens-locale"]);
	}
	if (typeof stored["storylens-font-face"] === "string") {
		setTooltipFontFace(stored["storylens-font-face"]);
	}
	if (typeof stored["storylens-font-size"] === "number") {
		setTooltipFontSize(stored["storylens-font-size"]);
	}

	browser.storage.onChanged.addListener((changes) => {
		if (typeof changes["storylens-locale"]?.newValue === "string") {
			setTooltipLocale(changes["storylens-locale"].newValue as string);
		}
		if (typeof changes["storylens-font-face"]?.newValue === "string") {
			setTooltipFontFace(changes["storylens-font-face"].newValue as string);
		}
		if (typeof changes["storylens-font-size"]?.newValue === "number") {
			setTooltipFontSize(changes["storylens-font-size"].newValue as number);
		}
	});

	console.log(`${LOG_PREFIX} Content script loaded`, {
		url: window.location.href,
		hostname: window.location.hostname,
	});

	await loadWebsiteSelector();
	await reportCurrentNovel();

	// Defer highlighting so message handlers stay responsive during page load.
	queueMicrotask(() => {
		void handleDetectedNovel().catch((error) => {
			console.error(
				`${LOG_PREFIX} Failed during initial novel processing`,
				error,
			);
		});
	});

	ctx.addEventListener(window, "wxt:locationchange", () => {
		console.log(`${LOG_PREFIX} Location changed`, window.location.href);
		lastProcessedKey = undefined;
		void loadWebsiteSelector()
			.then(() => reportCurrentNovel())
			.then(() => handleDetectedNovel())
			.catch((error) => {
				console.error(
					`${LOG_PREFIX} Failed during navigation novel processing`,
					error,
				);
			});
	});
}
