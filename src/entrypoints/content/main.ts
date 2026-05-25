import type { ContentScriptContext } from "#imports";
import { onMessage, sendMessage } from "@/entrypoints/background/messaging";
import type { currentNovelMeta } from "@/types";
import { removeExtensionMarkup } from "@/utils/content-processor";
import { processDetectedNovel } from "@/utils/process-detected-novel";
import { sanitizePageHtml } from "@/utils/sanitize-page-html";
import { getAllNovelData } from "@/utils/site-detection";

const LOG_PREFIX = "[StoryLens]";

let websiteSelectorsValue: string | undefined;
let lastProcessedKey: string | undefined;

function buildDetectedNovelKey(meta: currentNovelMeta): string {
	return `${meta.novelSlug}:${meta.chapter ?? "unknown"}`;
}

async function loadWebsiteSelectors(): Promise<void> {
	try {
		websiteSelectorsValue = await sendMessage("getWebsiteSelectors");
		console.log(`${LOG_PREFIX} Website selectors loaded`, {
			hasSelectors: !!websiteSelectorsValue,
		});
	} catch (error) {
		console.error(`${LOG_PREFIX} Failed to load website selectors`, error);
		websiteSelectorsValue = undefined;
	}
}

function detectCurrentNovel(): currentNovelMeta | undefined {
	const website = window.location.hostname;
	if (!website) {
		console.log(`${LOG_PREFIX} No hostname detected`);
		return undefined;
	}

	const novel = getAllNovelData(websiteSelectorsValue, website, document);
	if (!novel) {
		console.log(`${LOG_PREFIX} No novel detected on page`, {
			website,
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
	onMessage("websiteSelectorsUpdated", ({ data }) => {
		websiteSelectorsValue = data;
		console.log(`${LOG_PREFIX} Website selectors updated from background`, {
			hasSelectors: !!websiteSelectorsValue,
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

	onMessage("getCurrentNovel", () => {
		return detectCurrentNovel();
	});

	console.log(`${LOG_PREFIX} Content script loaded`, {
		url: window.location.href,
		hostname: window.location.hostname,
	});

	await loadWebsiteSelectors();
	await reportCurrentNovel();

	try {
		await handleDetectedNovel();
	} catch (error) {
		console.error(
			`${LOG_PREFIX} Failed during initial novel processing`,
			error,
		);
	}

	ctx.addEventListener(window, "wxt:locationchange", () => {
		console.log(`${LOG_PREFIX} Location changed`, window.location.href);
		lastProcessedKey = undefined;
		void loadWebsiteSelectors()
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
