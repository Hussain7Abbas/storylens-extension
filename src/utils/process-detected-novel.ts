import type { currentNovelMeta } from "@/types";
import {
	applyContentProcessing,
	buildProcessKey,
	findContentRoot,
	removeExtensionMarkup,
} from "@/utils/content-processor";
import { loadNovelContentData } from "@/utils/load-novel-content-data";

const LOG_PREFIX = "[StoryLens]";
const MAX_CONTENT_ATTEMPTS = 6;
const CONTENT_RETRY_MS = 500;
let latestRequest = 0;

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function waitForContentRoot(): Promise<HTMLElement | undefined> {
	for (let attempt = 0; attempt < MAX_CONTENT_ATTEMPTS; attempt += 1) {
		const root = findContentRoot();
		const textLength = root.textContent?.trim().length ?? 0;

		console.log(`${LOG_PREFIX} Content root check`, {
			attempt: attempt + 1,
			textLength,
		});

		if (textLength > 100) {
			return root;
		}

		if (attempt < MAX_CONTENT_ATTEMPTS - 1) {
			await sleep(CONTENT_RETRY_MS);
		}
	}

	return undefined;
}

export async function processDetectedNovel(
	meta: currentNovelMeta,
	options?: { force?: boolean },
): Promise<void> {
	const request = ++latestRequest;
	const url = window.location.href;
	const isCurrent = () =>
		request === latestRequest && url === window.location.href;
	console.log(`${LOG_PREFIX} Processing detected novel`, meta);

	try {
		const contentData = await loadNovelContentData(meta);
		if (!contentData || !isCurrent()) {
			return;
		}

		const contentRoot = await waitForContentRoot();
		if (!contentRoot) {
			console.warn(
				`${LOG_PREFIX} Chapter content was not ready for processing`,
			);
			return;
		}

		if (!isCurrent()) return;
		// Keep the previous colors until a current response can replace them.
		// Cleanup and reapplication are synchronous so the page never paints bare text.
		if (options?.force) removeExtensionMarkup();
		applyContentProcessing(
			contentRoot,
			contentData,
			buildProcessKey(meta.novelSlug, meta.chapter),
			{ force: options?.force },
		);
	} catch (error) {
		console.error(`${LOG_PREFIX} Failed to process detected novel`, error);
	}
}
