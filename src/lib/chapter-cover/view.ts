import { createElement, Ellipsis } from "lucide";
import {
	CHAPTER_ERROR_DETAILS_CSS,
	createChapterErrorDetails,
} from "@/lib/ai-source/chapter-error-details";
import { LENS_COIN_MOTION_CSS } from "@/lib/lens-coin";
import { contentThemeCss } from "@/styles/palette";

import {
	COVER_PROMPT_EDITOR_CSS,
	type CoverPromptLabels,
	createCoverPromptEditor,
} from "./prompt-editor";

type CoverLabels = CoverPromptLabels & {
	actions: string;
	ready: string;
	copy: string;
	generate: string;
	regenerate: string;
	stop: string;
	save: string;
	download: string;
};

/** A bare image with a hover/focus disclosure, isolated from novel-site styles. */
export function createCoverView(
	locale: "en" | "ar",
	chapterNumber: number,
	text: CoverLabels,
) {
	const host = document.createElement("div");
	host.id = "storylens-chapter-cover";
	host.setAttribute("data-storylens-skip", "");
	host.dir = locale === "ar" ? "rtl" : "ltr";
	host.lang = locale;
	host.style.cssText =
		"all:initial;display:block;position:relative;inline-size:100%;z-index:1;margin-block-end:24px;color:var(--ink);font:16px/1.6 system-ui,sans-serif";
	const shadow = host.attachShadow({ mode: "open" });
	const style = document.createElement("style");
	style.textContent = `${contentThemeCss}${LENS_COIN_MOTION_CSS}${CHAPTER_ERROR_DETAILS_CSS}${COVER_PROMPT_EDITOR_CSS}
:host{all:initial;display:block;position:relative;margin-block-end:24px;color:var(--ink);font:16px/1.6 system-ui,sans-serif;direction:${locale === "ar" ? "rtl" : "ltr"}}
img{display:block;inline-size:100%;block-size:auto;max-block-size:none;pointer-events:auto;user-select:auto;-webkit-user-drag:auto}
.status{box-sizing:border-box;margin:0;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--surface);padding:12px;padding-inline-end:68px;min-block-size:68px}
.status:empty{display:none}
.menu{position:absolute;inset-block-start:12px;inset-inline-end:12px;z-index:1;opacity:0;pointer-events:none;transition:opacity 160ms ease}
:host(:hover) .menu,:host(:focus-within) .menu,.menu[open],:host(:not([data-ready])) .menu{opacity:1;pointer-events:auto}
.menu>summary{display:grid;place-items:center;inline-size:44px;block-size:44px;box-sizing:border-box;list-style:none;border:1px solid var(--border);border-radius:50%;background:var(--surface);color:var(--ink);cursor:pointer}
.menu>summary::-webkit-details-marker{display:none}
.menu>summary svg{inline-size:22px;block-size:22px}
.actions{position:absolute;inset-block-start:52px;inset-inline-end:0;display:grid;gap:4px;box-sizing:border-box;inline-size:max-content;max-inline-size:calc(100vw - 48px);padding:6px;border:1px solid var(--border);border-radius:12px;background:var(--surface);box-shadow:0 8px 24px color-mix(in srgb,var(--ink) 16%,transparent)}
button,a{display:flex;align-items:center;gap:6px;box-sizing:border-box;min-block-size:44px;padding:8px 12px;border:0;border-radius:6px;background:var(--surface);color:var(--ink);font:500 14px/1.6 system-ui,sans-serif;text-align:start;white-space:normal;overflow-wrap:anywhere;cursor:pointer;text-decoration:none}
button:hover,a:hover,summary:hover{background:var(--soft)}
button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
button:disabled{opacity:.6;cursor:not-allowed}
[hidden]{display:none!important}
@media(hover:none){.menu{opacity:1;pointer-events:auto}}
@media(prefers-reduced-motion:reduce){.menu{transition:none}}
@media(forced-colors:active){summary,.actions{border:1px solid ButtonText}}
`;
	const image = document.createElement("img");
	image.alt = `${text.ready} ${chapterNumber}`;
	image.hidden = true;
	const status = document.createElement("p");
	status.className = "status";
	status.setAttribute("role", "status");
	const errorDetails = createChapterErrorDetails(locale);
	const menu = document.createElement("details");
	menu.className = "menu";
	const trigger = document.createElement("summary");
	trigger.setAttribute("aria-label", text.actions);
	trigger.title = text.actions;
	trigger.append(
		createElement(Ellipsis, { "aria-hidden": "true", "stroke-width": 1.75 }),
	);
	const actions = document.createElement("div");
	actions.className = "actions";
	const makeButton = (label: string) => {
		const button = document.createElement("button");
		button.type = "button";
		button.textContent = label;
		return button;
	};
	const copy = makeButton(text.copy);
	const generate = makeButton(text.generate);
	const regenerate = makeButton(text.regenerate);
	regenerate.hidden = true;
	const stop = makeButton(text.stop);
	const save = makeButton(text.save);
	copy.disabled = true;
	generate.disabled = true;
	stop.hidden = true;
	save.hidden = true;
	const download = document.createElement("a");
	download.textContent = text.download;
	download.target = "_blank";
	download.rel = "noopener noreferrer";
	download.hidden = true;
	actions.append(copy, generate, regenerate, stop, save, download);
	menu.append(trigger, actions);
	const promptEditor = createCoverPromptEditor(text);
	shadow.append(
		style,
		image,
		status,
		menu,
		promptEditor.promptSection,
		errorDetails.element,
	);
	// Novel sites often open their reading controls on every page click.
	shadow.addEventListener("click", (event) => event.stopPropagation());

	const listeners = new AbortController();
	document.addEventListener(
		"pointerdown",
		(event) => {
			if (!event.composedPath().includes(host)) menu.open = false;
		},
		{ signal: listeners.signal },
	);
	menu.addEventListener("keydown", (event) => {
		if (event.key !== "Escape" || !menu.open) return;
		event.preventDefault();
		event.stopPropagation();
		menu.open = false;
		trigger.focus();
	});
	actions.addEventListener("click", (event) => {
		if (
			event.target instanceof Element &&
			event.target.closest("button:not(:disabled),a")
		)
			menu.open = false;
	});
	return {
		host,
		...promptEditor,
		status,
		image,
		generate,
		regenerate,
		copy,
		stop,
		save,
		download,
		showError(error: unknown) {
			errorDetails.show(error);
			host.setAttribute("data-error", "");
		},
		clearError() {
			errorDetails.clear();
			host.removeAttribute("data-error");
		},
		disposeMenu: () => listeners.abort(),
	};
}
