import { browser } from "#imports";
import { sendMessage } from "@/entrypoints/background/messaging";

export type PageContext = {
	url: string;
	html: string;
};

export type PageContextError =
	| "no-tab"
	| "unsupported-url"
	| "no-content-script";

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function isSupportedPageUrl(url: string | undefined): url is string {
	if (!url) {
		return false;
	}

	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

async function readPageHtml(tabId: number): Promise<PageContext | null> {
	const page = await sendMessage("getPageHtml", undefined, { tabId });
	if (!page?.url || !page.html.trim()) {
		return null;
	}

	return page;
}

export async function getActiveTabPageContext(): Promise<
	{ ok: true; page: PageContext } | { ok: false; error: PageContextError }
> {
	const [tab] = await browser.tabs.query({
		active: true,
		lastFocusedWindow: true,
	});

	if (!tab?.id) {
		return { ok: false, error: "no-tab" };
	}

	if (!isSupportedPageUrl(tab.url)) {
		return { ok: false, error: "unsupported-url" };
	}

	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const page = await readPageHtml(tab.id);
			if (page) {
				return { ok: true, page };
			}
		} catch (error) {
			console.error("[StoryLens] Failed to read page HTML from tab", {
				tabId: tab.id,
				attempt,
				error,
			});
		}

		if (attempt < 2) {
			await sleep(250);
		}
	}

	return { ok: false, error: "no-content-script" };
}
