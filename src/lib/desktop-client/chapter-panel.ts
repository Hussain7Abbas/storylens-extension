import { browser } from "#imports";
import { pageAiTasks } from "@/lib/launcher-frame/ai-tasks";
import { contentThemeCss } from "@/styles/palette";
import { findContentRoot } from "@/utils/content-processor";
import { EXTRACTION_VIEW } from "./chapter-extraction";

const PANEL_ID = "storylens-chapter-extraction";
/** Messages the embedded extraction page posts to this panel. */
export const EXTRACTION_PANEL_MESSAGE = "storylens-extraction-panel";
export type ExtractionPanelMessage =
	| { type: typeof EXTRACTION_PANEL_MESSAGE; action: "resize"; height: number }
	| { type: typeof EXTRACTION_PANEL_MESSAGE; action: "close" };

let current:
	| { host: HTMLElement; onMessage: (event: MessageEvent) => void }
	| undefined;

const labels = {
	en: { heading: "Story Lens: chapter characters", close: "Close" },
	ar: { heading: "عدسة القصة: شخصيات الفصل", close: "إغلاق" },
};

export function clearChapterExtraction(): void {
	if (!current) return;
	// The frame goes with the panel, so its extraction and unsaved rows end here.
	pageAiTasks.drop((task) => task.source === "panel");
	window.removeEventListener("message", current.onMessage);
	current.host.remove();
	current = undefined;
}

/** Shows the AI character extraction table at the start of the chapter content. */
export function startChapterExtraction(locale: string): void {
	clearChapterExtraction();
	const language = locale.toLowerCase().startsWith("ar") ? "ar" : "en";
	const text = labels[language];
	const host = document.createElement("div");
	host.id = PANEL_ID;
	// Keeps highlighting and page-text reading out of the panel.
	host.setAttribute("data-storylens-skip", "");
	host.style.cssText =
		"all:initial;display:block;position:relative;z-index:2147483646;";
	const shadow = host.attachShadow({ mode: "open" });
	const style = document.createElement("style");
	style.textContent =
		contentThemeCss +
		":host{all:initial;display:block}section{box-sizing:border-box;border:1px solid var(--border);border-inline-start:3px solid var(--accent);border-radius:12px;background:var(--surface);color:var(--ink);font:16px/1.5 system-ui,sans-serif;max-width:1200px;margin:12px auto;padding:12px 16px;box-shadow:0 8px 24px rgb(32 33 50 / .12)}header{display:flex;flex-wrap:wrap;align-items:center;gap:12px;justify-content:space-between;margin-bottom:8px}h2{font:600 1.2em/1.2 system-ui,sans-serif;margin:0}section[dir=rtl] h2{font-family:system-ui,sans-serif}button{background:var(--accent);border:1px solid var(--accent);border-radius:.65rem;color:var(--on-accent);font:500 .85em system-ui,sans-serif;min-height:44px;padding:5px 12px;cursor:pointer}button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}iframe{display:block;width:100%;height:160px;border:0;background:transparent;color-scheme:normal}";
	const section = document.createElement("section");
	section.setAttribute("dir", language === "ar" ? "rtl" : "ltr");
	const header = document.createElement("header");
	const heading = document.createElement("h2");
	heading.textContent = text.heading;
	const closeButton = document.createElement("button");
	closeButton.type = "button";
	closeButton.textContent = text.close;
	closeButton.addEventListener("click", clearChapterExtraction);
	header.append(heading, closeButton);
	const frame = document.createElement("iframe");
	frame.title = text.heading;
	frame.src = `${browser.runtime.getURL("/popup.html")}?view=${EXTRACTION_VIEW}`;
	section.append(header, frame);
	shadow.append(style, section);
	const onMessage = (event: MessageEvent) => {
		// Only the embedded extension page may resize or close the panel.
		if (event.source !== frame.contentWindow) return;
		const data = event.data as Partial<ExtractionPanelMessage> | null;
		if (data?.type !== EXTRACTION_PANEL_MESSAGE) return;
		if (data.action === "close") clearChapterExtraction();
		else if (
			data.action === "resize" &&
			typeof data.height === "number" &&
			Number.isFinite(data.height)
		)
			frame.style.height = `${Math.min(Math.max(data.height, 80), 5000)}px`;
	};
	window.addEventListener("message", onMessage);
	findContentRoot().prepend(host);
	current = { host, onMessage };
	host.scrollIntoView({ block: "start", behavior: "smooth" });
}
