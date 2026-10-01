import { browser, type ContentScriptContext } from "#imports";
import { onMessage, sendMessage } from "@/entrypoints/background/messaging";
import { trackEvent } from "@/lib/analytics/client";
import { AUTH_STORAGE_KEY, parseStoredAuth } from "@/lib/auth/auth-storage";
import { CHAPTER_TEXT_CHARS } from "@/lib/desktop-client/chapter-extraction";
import { clearChapterExtraction } from "@/lib/desktop-client/chapter-panel";
import { clearPageSummary } from "@/lib/desktop-client/page-summary";
import { pageAiTasks, parseAiTaskReport } from "@/lib/launcher-frame/ai-tasks";
import { PAGE_POPUP_VISIBLE_KEY } from "@/lib/page-popup-settings";
import type { currentNovelMeta } from "@/types";
import type { websiteSelector as WebsiteSelector } from "@/types/configs";
import {
	findContentRoot,
	removeExtensionMarkup,
} from "@/utils/content-processor";
import {
	setTooltipFontFace,
	setTooltipFontSize,
	setTooltipLocale,
	setTooltipUser,
} from "@/utils/keyword-tooltip";
import { readPageText } from "@/utils/page-text";
import { processDetectedNovel } from "@/utils/process-detected-novel";
import { sanitizePageHtml } from "@/utils/sanitize-page-html";
import { getAllNovelData } from "@/utils/site-detection";
import {
	pagePopupLauncherNavigated,
	setPagePopupLauncher,
} from "./page-popup-launcher";

const LOG_PREFIX = "[StoryLens]";

let websiteSelector: WebsiteSelector | undefined;
let lastProcessedKey: string | undefined;
let currentLocale = "en";
let pagePopupVisible = true;

function buildDetectedNovelKey(meta: currentNovelMeta): string {
	return `${meta.novelSlug}:${meta.chapter ?? "unknown"}`;
}

async function loadWebsiteSelector(): Promise<void> {
	const website = window.location.hostname;
	if (!website) {
		websiteSelector = undefined;
		setPagePopupLauncher(false, currentLocale);
		return;
	}

	try {
		websiteSelector = await sendMessage("getWebsiteSelector", website);
		setPagePopupLauncher(!!websiteSelector && pagePopupVisible, currentLocale);
		console.log(`${LOG_PREFIX} Website selector loaded`, {
			website,
			hasSelector: !!websiteSelector,
		});
	} catch (error) {
		console.error(`${LOG_PREFIX} Failed to load website selector`, error);
		websiteSelector = undefined;
		setPagePopupLauncher(false, currentLocale);
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
		trackEvent("novel_page_view", {
			website: window.location.hostname,
			has_chapter: novel.chapter !== undefined,
		});
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
		setPagePopupLauncher(!!websiteSelector && pagePopupVisible, currentLocale);
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

	onMessage("refreshContent", ({ data }) => {
		// A refresh meant for another novel (the tab navigated since) is ignored.
		const current = detectCurrentNovel();
		if (data?.novelSlug && current && current.novelSlug !== data.novelSlug)
			return;
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

	// AI tasks of the Story Lens frames in this tab, listed under the launcher.
	onMessage("aiTaskUpdated", ({ data }) => {
		const report = parseAiTaskReport(data);
		if (report) pageAiTasks.apply(report);
	});

	onMessage("getChapterText", () => ({
		text: readPageText(findContentRoot(), CHAPTER_TEXT_CHARS),
	}));

	onMessage("getCurrentNovel", async () => {
		if (!websiteSelector) {
			await loadWebsiteSelector();
		}

		return detectCurrentNovel();
	});

	const stored = await browser.storage.local.get([
		PAGE_POPUP_VISIBLE_KEY,
		AUTH_STORAGE_KEY,
		"storylens-locale",
		"storylens-font-face",
		"storylens-font-size",
	]);
	pagePopupVisible = stored[PAGE_POPUP_VISIBLE_KEY] !== false;
	// Tooltip Edit buttons follow the reader's per-row permissions.
	setTooltipUser(parseStoredAuth(stored[AUTH_STORAGE_KEY]).user);
	if (typeof stored["storylens-locale"] === "string") {
		currentLocale = stored["storylens-locale"];
		setTooltipLocale(currentLocale);
	}
	if (typeof stored["storylens-font-face"] === "string") {
		setTooltipFontFace(stored["storylens-font-face"]);
	}
	if (typeof stored["storylens-font-size"] === "number") {
		setTooltipFontSize(stored["storylens-font-size"]);
	}

	browser.storage.onChanged.addListener((changes, area) => {
		if (area !== "local") return;
		if (AUTH_STORAGE_KEY in changes) {
			setTooltipUser(parseStoredAuth(changes[AUTH_STORAGE_KEY].newValue).user);
		}
		if (PAGE_POPUP_VISIBLE_KEY in changes) {
			pagePopupVisible = changes[PAGE_POPUP_VISIBLE_KEY].newValue !== false;
			setPagePopupLauncher(
				!!websiteSelector && pagePopupVisible,
				currentLocale,
			);
		}
		if (typeof changes["storylens-locale"]?.newValue === "string") {
			const localeChanged =
				currentLocale !== changes["storylens-locale"].newValue;
			currentLocale = changes["storylens-locale"].newValue as string;
			setTooltipLocale(currentLocale);
			setPagePopupLauncher(
				!!websiteSelector && pagePopupVisible,
				currentLocale,
			);
			// Pages match the UI language's keyword names, so switching it re-highlights.
			if (localeChanged && lastProcessedKey) {
				void refreshPageContent().catch((error) => {
					console.error(
						`${LOG_PREFIX} Failed to refresh after a language change`,
						error,
					);
				});
			}
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
		clearPageSummary();
		clearChapterExtraction();
		pagePopupLauncherNavigated();
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
