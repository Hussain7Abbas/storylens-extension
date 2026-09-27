import {
	createElement,
	type IconNode,
	ListFilter,
	Plus,
	TextSearch,
} from "lucide";
import { browser } from "#imports";
import { trackEvent } from "@/lib/analytics/client";
import { isAiConfigured } from "@/lib/desktop-client/ai-config";
import { startChapterExtraction } from "@/lib/desktop-client/chapter-panel";
import {
	encodeKeywordContext,
	KEYWORD_CONTEXT_PARAM,
	type KeywordContext,
} from "@/lib/desktop-client/keyword-suggestion";
import { startPageSummary } from "@/lib/desktop-client/page-summary";
import { parseDesktopSettings } from "@/lib/desktop-client/settings";
import {
	DESKTOP_SETTINGS_KEY,
	type DesktopSettings,
} from "@/lib/desktop-client/types";
import { contentThemeCss, palette } from "@/styles/palette";
import { textAround } from "@/utils/page-text";

const HOST_ID = "storylens-page-launcher";
const POSITION_KEY = "storylens-page-launcher-position";
const BUTTON_SIZE = 52;
const EDGE = 8;
const GAP = 8;
const POPUP_WIDTH = 390;
const POPUP_HEIGHT = 640;
const ACTION_SIZE = 44;
const ACTION_GAP = 8;
const ACTION_SHOW_DELAY = 200;
const ACTION_HIDE_DELAY = 300;
const NOTICE_DURATION = 3500;
const UNLOCK_STYLE_ID = "storylens-selection-unlock";
// Page handlers for these events can cancel or clear a selection; skip them while picking.
const SELECTION_GUARD_EVENTS = [
	"selectstart",
	"selectionchange",
	"mousedown",
	"mouseup",
	"dragstart",
] as const;

type Position = { x: number; y: number };
type Launcher = {
	host: HTMLElement;
	setLocale: (locale: string) => void;
	close: () => void;
	dispose: () => void;
};

let launcher: Launcher | undefined;

function labels(locale: string): {
	open: string;
	close: string;
	select: string;
	summarize: string;
	extract: string;
	configureAi: string;
	selectHint: string;
} {
	return locale.toLowerCase().startsWith("ar")
		? {
				open: "افتح عدسة القصة",
				close: "إغلاق عدسة القصة",
				select: "حدد نصاً في الصفحة",
				summarize: "لخّص الصفحة بالذكاء الاصطناعي",
				extract: "استخرج شخصيات الفصل بالذكاء الاصطناعي",
				configureAi: "يرجى إعداد الذكاء الاصطناعي من الإعدادات.",
				selectHint: "انقر على كلمة أو اسحب لتحديد نص. اضغط Escape للإلغاء.",
			}
		: {
				open: "Open Story Lens",
				close: "Close Story Lens",
				select: "Select text on page",
				summarize: "Summarize page with AI",
				extract: "Extract chapter characters with AI",
				configureAi: "Please configure AI in the settings.",
				selectHint:
					"Click a word or drag to select text. Press Escape to cancel.",
			};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}

function clampPosition(position: Position, size: number): Position {
	const maxX = Math.max(0, window.innerWidth - size);
	const maxY = Math.max(0, window.innerHeight - size);
	const edgeX = maxX >= EDGE * 2 ? EDGE : 0;
	const edgeY = maxY >= EDGE * 2 ? EDGE : 0;
	return {
		x: clamp(position.x, edgeX, maxX - edgeX),
		y: clamp(position.y, edgeY, maxY - edgeY),
	};
}

function storedPosition(value: unknown): Position | undefined {
	if (!value || typeof value !== "object") return undefined;
	const position = value as Partial<Position>;
	return typeof position.x === "number" &&
		Number.isFinite(position.x) &&
		typeof position.y === "number" &&
		Number.isFinite(position.y)
		? { x: position.x, y: position.y }
		: undefined;
}

function stopPageSelectionGuard(event: Event): void {
	event.stopImmediatePropagation();
}

/** Lifts copy-protection (CSS `user-select:none`, cancelled `selectstart`) while picking text. */
function setPageSelectionUnlocked(unlocked: boolean): void {
	document.getElementById(UNLOCK_STYLE_ID)?.remove();
	for (const type of SELECTION_GUARD_EVENTS)
		window.removeEventListener(type, stopPageSelectionGuard, true);
	if (!unlocked) return;
	const style = document.createElement("style");
	style.id = UNLOCK_STYLE_ID;
	style.setAttribute("data-storylens-skip", "");
	style.textContent = `*,*::before,*::after{-webkit-user-select:text!important;user-select:text!important;-webkit-touch-callout:default!important}*::selection{background:${palette.dark.accent}!important;color:${palette.dark.onAccent}!important}`;
	(document.head ?? document.documentElement).append(style);
	// Window capture runs before any document or element listener the page registers.
	for (const type of SELECTION_GUARD_EVENTS)
		window.addEventListener(type, stopPageSelectionGuard, true);
}

function createLauncher(locale: string): Launcher {
	let currentLocale = locale;
	let selecting = false;
	let desktop: DesktopSettings = parseDesktopSettings(undefined);
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	let selectionStart: Position | undefined;
	let position: Position = { x: window.innerWidth - BUTTON_SIZE - 16, y: 16 };
	let interacted = false;
	let suppressClick = false;
	let cursor: Position | undefined;
	let revealed = false;
	let tucked = false;
	let actionTimer: ReturnType<typeof setTimeout> | undefined;
	let drag:
		| {
				pointerId: number;
				startX: number;
				startY: number;
				origin: Position;
				moved: boolean;
		  }
		| undefined;

	const host = document.createElement("div");
	host.id = HOST_ID;
	host.setAttribute("data-storylens-skip", "");
	host.style.cssText =
		"all:initial;position:fixed;width:min(52px,100vw,100vh);height:min(52px,100vw,100vh);z-index:2147483647;";
	const shadow = host.attachShadow({ mode: "open" });
	const style = document.createElement("style");
	style.textContent = `
		:host{all:initial}
		${contentThemeCss}
		button{font:600 14px system-ui,sans-serif;cursor:pointer}
		#launcher{display:grid;place-items:center;width:100%;height:100%;padding:2px;border:1px solid var(--border);border-radius:50%;background:var(--surface);box-shadow:0 3px 14px rgb(32 33 50 / .35);touch-action:none;user-select:none;box-sizing:border-box;transition:transform 180ms ease}
		@media(prefers-reduced-motion:reduce){#launcher{transition:none}}
		#launcher:hover,#launcher:focus-visible{border-color:var(--accent);outline:3px solid var(--accent);outline-offset:2px}
		#logo{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none}
		#panel{position:fixed;box-sizing:border-box;border:1px solid var(--border);border-radius:12px;background:var(--paper);box-shadow:0 24px 80px rgb(32 33 50 / .25);overflow:hidden}
		#panel[hidden]{display:none}
		iframe{display:block;border:0;background:var(--paper);transform-origin:top left}
		@media(prefers-color-scheme:dark){#panel{box-shadow:0 24px 80px #0008}}
		#actions{position:absolute;display:flex;gap:${ACTION_GAP}px}
		#actions[hidden]{display:none}
		#actions[data-side="below"]{top:calc(100% + ${GAP}px)}
		#actions[data-side="above"]{bottom:calc(100% + ${GAP}px)}
		#actions[data-align="start"]{left:${(BUTTON_SIZE - ACTION_SIZE) / 2}px}
		#actions[data-align="end"]{right:${(BUTTON_SIZE - ACTION_SIZE) / 2}px;flex-direction:row-reverse}
		.action{display:grid;place-items:center;width:${ACTION_SIZE}px;height:${ACTION_SIZE}px;padding:0;border:1px solid var(--border);border-radius:50%;background:var(--surface);color:var(--accent);box-shadow:0 3px 10px rgb(32 33 50 / .3);box-sizing:border-box}
		.action:hover,.action:focus-visible{border-color:var(--accent);outline:3px solid var(--accent);outline-offset:2px}
		.action[aria-disabled="true"]{color:var(--muted);cursor:not-allowed}
		.action svg{width:18px;height:18px;pointer-events:none}
		.action:hover{background:var(--soft)}
	`;
	const button = document.createElement("button");
	button.id = "launcher";
	button.type = "button";
	button.setAttribute("aria-haspopup", "dialog");
	button.setAttribute("aria-expanded", "false");
	button.setAttribute("aria-label", labels(locale).open);
	button.title = labels(locale).open;
	const logo = document.createElement("img");
	logo.id = "logo";
	logo.alt = "";
	logo.draggable = false;
	logo.src = browser.runtime.getURL("/icons/128.png");
	button.append(logo);
	const actions = document.createElement("div");
	actions.id = "actions";
	actions.hidden = true;
	const createAction = (name: string, icon: IconNode) => {
		const element = document.createElement("button");
		element.className = "action";
		element.dataset.action = name;
		element.type = "button";
		element.append(
			createElement(icon, { "aria-hidden": "true", "stroke-width": 1.75 }),
		);
		actions.append(element);
		return element;
	};
	const action = createAction("select", Plus);
	const summarizeAction = createAction("summarize", TextSearch);
	const extractAction = createAction("extract", ListFilter);
	const panel = document.createElement("section");
	panel.id = "panel";
	panel.hidden = true;
	panel.setAttribute("role", "dialog");
	panel.setAttribute("aria-label", labels(locale).open);
	const hint = document.createElement("div");
	hint.hidden = true;
	hint.setAttribute("role", "status");
	hint.style.cssText =
		"position:fixed;top:12px;left:50%;transform:translateX(-50%);padding:10px 16px;border-radius:8px;border-inline-start:3px solid var(--accent);background:var(--surface);color:var(--ink);font:14px/1.5 system-ui,sans-serif;box-shadow:0 8px 24px rgb(0 0 0 / .25);pointer-events:none;max-width:80vw;";
	const updateHint = () => {
		const text = labels(currentLocale);
		hint.textContent = text.selectHint;
	};
	const updateActionLabels = () => {
		const text = labels(currentLocale);
		const describe = (
			element: HTMLButtonElement,
			label: string,
			ai = false,
		) => {
			const unavailable = ai && !isAiConfigured(desktop);
			element.setAttribute("aria-label", label);
			element.setAttribute("aria-disabled", String(unavailable));
			// Screen readers get the same reason as the hover tooltip.
			element.title = unavailable ? text.configureAi : label;
			if (unavailable)
				element.setAttribute("aria-description", text.configureAi);
			else element.removeAttribute("aria-description");
		};
		describe(action, text.select);
		describe(summarizeAction, text.summarize, true);
		describe(extractAction, text.extract, true);
	};
	updateHint();
	updateActionLabels();
	shadow.append(style, button, actions, panel, hint);
	(document.body ?? document.documentElement).append(host);

	let layoutSelection: (() => void) | undefined;
	const layoutPopup = () => {
		if (layoutSelection) {
			layoutSelection();
			return;
		}
		if (panel.hidden) return;
		const size = button.offsetWidth || BUTTON_SIZE;
		const rect = {
			left: position.x,
			top: position.y,
			right: position.x + size,
			bottom: position.y + size,
			width: size,
			height: size,
		};
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const rightSpace = Math.max(0, viewportWidth - EDGE - rect.right - GAP);
		const leftSpace = Math.max(0, rect.left - EDGE - GAP);
		const belowSpace = Math.max(0, viewportHeight - EDGE - rect.bottom - GAP);
		const aboveSpace = Math.max(0, rect.top - EDGE - GAP);
		const preferRight = rect.left + rect.width / 2 < viewportWidth / 2;
		const preferBelow = rect.top + rect.height / 2 < viewportHeight / 2;
		const useRight = preferRight
			? rightSpace >= 280 || rightSpace >= leftSpace
			: rightSpace > leftSpace && leftSpace < 280;
		const sideSpace = useRight ? rightSpace : leftSpace;
		const adjacentHorizontally = sideSpace >= 280;
		const width = Math.max(
			1,
			Math.min(
				POPUP_WIDTH,
				adjacentHorizontally ? sideSpace : viewportWidth - EDGE * 2,
			),
		);
		const x = adjacentHorizontally
			? useRight
				? rect.right + GAP
				: rect.left - GAP - width
			: clamp(rect.left, EDGE, viewportWidth - EDGE - width);
		const useBelow = preferBelow
			? belowSpace >= 320 || belowSpace >= aboveSpace
			: belowSpace > aboveSpace && aboveSpace < 320;
		const verticalSpace = useBelow ? belowSpace : aboveSpace;
		const adjacentVertically = verticalSpace >= 320;
		const height = Math.max(
			1,
			Math.min(
				POPUP_HEIGHT,
				adjacentVertically ? verticalSpace : viewportHeight - EDGE * 2,
			),
		);
		const y = adjacentVertically
			? useBelow
				? rect.bottom + GAP
				: rect.top - GAP - height
			: clamp(rect.top, EDGE, viewportHeight - EDGE - height);
		panel.style.left = `${clamp(x, 0, viewportWidth - width)}px`;
		panel.style.top = `${clamp(y, 0, viewportHeight - height)}px`;
		panel.style.width = `${width}px`;
		panel.style.height = `${height}px`;
		const frame = panel.querySelector("iframe");
		if (frame) {
			const contentWidth = Math.max(1, width - 2);
			const scale = Math.min(1, contentWidth / 384);
			frame.style.width = `${Math.max(384, contentWidth)}px`;
			frame.style.height = `${Math.max(1, (height - 2) / scale)}px`;
			frame.style.transform = `scale(${scale})`;
		}
	};
	const updateTuck = () => {
		const size = button.offsetWidth || BUTTON_SIZE;
		const edges = [
			{ distance: position.x, x: 3 - size, y: position.y },
			{
				distance: window.innerWidth - position.x - size,
				x: window.innerWidth - 3,
				y: position.y,
			},
			{ distance: position.y, x: position.x, y: 3 - size },
			{
				distance: window.innerHeight - position.y - size,
				x: position.x,
				y: window.innerHeight - 3,
			},
		];
		const edge = edges.reduce((nearest, candidate) =>
			candidate.distance < nearest.distance ? candidate : nearest,
		);
		const near = (point: Position) =>
			cursor !== undefined &&
			cursor.x >= point.x - 10 &&
			cursor.x <= point.x + size + 10 &&
			cursor.y >= point.y - 10 &&
			cursor.y <= point.y + size + 10;
		const keepVisible =
			!!drag ||
			!panel.hidden ||
			!actions.hidden ||
			shadow.activeElement === button ||
			actions.contains(shadow.activeElement);
		revealed =
			edge.distance <= 10 && (near(edge) || (revealed && near(position)));
		tucked = edge.distance <= 10 && !keepVisible && !revealed;
		button.style.boxShadow = tucked ? "none" : "";
		button.style.transition = drag ? "none" : "";
		button.style.transform = tucked
			? `translate(${edge.x - position.x}px, ${edge.y - position.y}px)`
			: "";
	};
	const clearActionTimer = () => {
		clearTimeout(actionTimer);
		actionTimer = undefined;
	};
	const hideAction = () => {
		clearActionTimer();
		if (actions.hidden) return;
		actions.hidden = true;
		updateTuck();
	};
	const showAction = () => {
		clearActionTimer();
		if (drag || tucked || !panel.hidden || selecting) return;
		const size = button.offsetWidth || BUTTON_SIZE;
		// Open toward the larger half of the viewport so the actions stay visible.
		actions.dataset.side =
			position.y + size / 2 < window.innerHeight / 2 ? "below" : "above";
		actions.dataset.align =
			position.x + size / 2 < window.innerWidth / 2 ? "start" : "end";
		actions.hidden = false;
		updateTuck();
	};
	const scheduleShowAction = () => {
		if (!actions.hidden) {
			clearActionTimer();
			return;
		}
		clearActionTimer();
		actionTimer = setTimeout(showAction, ACTION_SHOW_DELAY);
	};
	const scheduleHideAction = () => {
		clearActionTimer();
		if (actions.hidden) return;
		actionTimer = setTimeout(hideAction, ACTION_HIDE_DELAY);
	};
	const onButtonFocus = () => {
		updateTuck();
		if (button.matches(":focus-visible")) showAction();
	};
	const onControlBlur = (event: FocusEvent) => {
		updateTuck();
		const next = event.relatedTarget;
		if (next !== button && !(next instanceof Node && actions.contains(next)))
			scheduleHideAction();
	};
	const clearNotice = () => {
		clearTimeout(noticeTimer);
		noticeTimer = undefined;
	};
	const showNotice = (text: string) => {
		clearNotice();
		hint.textContent = text;
		hint.hidden = false;
		noticeTimer = setTimeout(() => {
			noticeTimer = undefined;
			updateHint();
			hint.hidden = !selecting;
		}, NOTICE_DURATION);
	};
	/** Returns whether the paired desktop client has a model to run AI actions. */
	const desktopReady = () => {
		if (isAiConfigured(desktop)) return true;
		showNotice(labels(currentLocale).configureAi);
		return false;
	};
	const onActionClick = () => {
		hideAction();
		selectText();
	};
	const onSummarizeClick = () => {
		if (!desktopReady()) return;
		hideAction();
		const result = startPageSummary({
			model: desktop.model,
			effort: desktop.effort,
			locale: currentLocale,
		});
		if (result.started)
			trackEvent("ai_summary_requested", { effort: desktop.effort });
	};
	const onExtractClick = () => {
		if (!desktopReady()) return;
		hideAction();
		// The embedded extraction page runs the AI request and tracks it.
		startChapterExtraction(currentLocale);
	};
	const onCursorMove = (event: PointerEvent) => {
		cursor = { x: event.clientX, y: event.clientY };
		updateTuck();
	};
	const onCursorLeave = () => {
		cursor = undefined;
		revealed = false;
		updateTuck();
	};
	const setPosition = (next: Position) => {
		position = clampPosition(
			next,
			button.getBoundingClientRect().width || BUTTON_SIZE,
		);
		host.style.left = `${position.x}px`;
		host.style.top = `${position.y}px`;
		updateTuck();
		layoutPopup();
	};
	let selectionMessageCleanup: (() => void) | undefined;
	const close = () => {
		selectionMessageCleanup?.();
		selectionMessageCleanup = undefined;
		layoutSelection = undefined;
		hideAction();
		clearNotice();
		selecting = false;
		setPageSelectionUnlocked(false);
		hint.hidden = true;
		selectionStart = undefined;
		panel.hidden = true;
		button.setAttribute("aria-expanded", "false");
		panel.querySelector("iframe")?.remove();
		updateTuck();
	};
	const open = (
		search?: string,
		context?: KeywordContext,
		extra?: Record<string, string>,
	) => {
		layoutSelection = undefined;
		hideAction();
		clearNotice();
		selecting = false;
		setPageSelectionUnlocked(false);
		hint.hidden = true;
		selectionStart = undefined;
		const frame = document.createElement("iframe");
		frame.title = labels(currentLocale).open;
		const params = new URLSearchParams(extra);
		if (search) params.set("search", search);
		// The popup reads this hidden context to request AI keyword suggestions.
		if (context)
			params.set(KEYWORD_CONTEXT_PARAM, encodeKeywordContext(context));
		const query = params.toString();
		frame.src =
			browser.runtime.getURL("/popup.html") + (query ? `?${query}` : "");
		panel.querySelector("iframe")?.remove();
		panel.append(frame);
		panel.hidden = false;
		button.setAttribute("aria-expanded", "true");
		updateTuck();
		layoutPopup();
	};
	const onButtonClick = () => {
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		interacted = true;
		if (panel.hidden) open();
		else close();
	};
	const onPointerDown = (event: PointerEvent) => {
		if (event.button !== 0 || drag) return;
		interacted = true;
		suppressClick = false;
		drag = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			origin: position,
			moved: false,
		};
		button.setPointerCapture(event.pointerId);
	};
	const onPointerMove = (event: PointerEvent) => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const dx = event.clientX - drag.startX;
		const dy = event.clientY - drag.startY;
		if (!drag.moved && Math.hypot(dx, dy) < 5) return;
		if (!drag.moved) close();
		hideAction();
		drag.moved = true;
		setPosition({ x: drag.origin.x + dx, y: drag.origin.y + dy });
	};
	const onPointerEnd = (event: PointerEvent) => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (drag.moved) {
			suppressClick = event.type === "pointerup";
			void browser.storage.local
				.set({ [POSITION_KEY]: position })
				.catch(() => {});
		}
		drag = undefined;
		updateTuck();
	};
	const onPointerOutside = (event: PointerEvent) => {
		if (selecting) {
			if (!host.contains(event.target as Node) && event.button === 0) {
				selectionStart = { x: event.clientX, y: event.clientY };
				window.getSelection()?.removeAllRanges();
			}
			return;
		}
		if (!host.contains(event.target as Node)) close();
	};
	const onSelectionEnd = (event: PointerEvent) => {
		if (
			!selecting ||
			!selectionStart ||
			event.button !== 0 ||
			host.contains(event.target as Node)
		)
			return;
		const start = selectionStart;
		selectionStart = undefined;
		// Let the browser finish its native drag selection before reading it.
		setTimeout(() => {
			if (!selecting || !host.isConnected) return;
			const selection = window.getSelection();
			let text = selection?.toString().trim() ?? "";
			let picked =
				text && selection?.rangeCount ? selection.getRangeAt(0) : undefined;
			if (
				!text &&
				Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5
			) {
				const caretDocument = document as Document & {
					caretPositionFromPoint?: (
						x: number,
						y: number,
					) => { offsetNode: Node; offset: number } | null;
					caretRangeFromPoint?: (x: number, y: number) => Range | null;
				};
				const caret = caretDocument.caretPositionFromPoint?.(
					event.clientX,
					event.clientY,
				);
				const range = caret
					? undefined
					: caretDocument.caretRangeFromPoint?.(event.clientX, event.clientY);
				const node = caret?.offsetNode ?? range?.startContainer;
				const offset = caret?.offset ?? range?.startOffset ?? 0;
				if (node?.nodeType === Node.TEXT_NODE) {
					const value = node.textContent ?? "";
					for (const match of value.matchAll(
						/[\p{L}\p{N}\p{M}]+(?:['’-][\p{L}\p{N}\p{M}]+)*/gu,
					)) {
						if (
							match.index <= offset &&
							offset <= match.index + match[0].length
						) {
							text = match[0];
							picked = document.createRange();
							picked.setStart(node, match.index);
							picked.setEnd(node, match.index + match[0].length);
							break;
						}
					}
				}
			}
			if (!text) return;
			const context = picked ? textAround(picked) : undefined;
			const rect = picked?.getBoundingClientRect();
			open(text, undefined, { view: "selection" });
			const chooser = panel.querySelector("iframe");
			let chooserHeight = 300;
			layoutSelection = () => {
				const width = Math.min(390, window.innerWidth - EDGE * 2);
				const height = Math.min(chooserHeight, window.innerHeight - EDGE * 2);
				panel.style.width = `${width}px`;
				panel.style.height = `${height}px`;
				panel.style.left = `${clamp((rect?.left ?? event.clientX) + (rect?.width ?? 0) / 2 - width / 2, EDGE, window.innerWidth - width - EDGE)}px`;
				panel.style.top = `${clamp((rect?.top ?? event.clientY) - height - GAP, EDGE, window.innerHeight - height - EDGE)}px`;
				if (chooser) {
					chooser.style.width = "100%";
					chooser.style.height = "100%";
					chooser.style.transform = "none";
				}
			};
			layoutSelection();
			const receive = (message: MessageEvent) => {
				if (
					message.source !== chooser?.contentWindow ||
					message.origin !==
						new URL(browser.runtime.getURL("/popup.html")).origin
				)
					return;
				const data: unknown = message.data;
				if (!data || typeof data !== "object" || !("type" in data)) return;
				if (
					data.type === "storylens-selection-resize" &&
					"height" in data &&
					typeof data.height === "number" &&
					Number.isFinite(data.height)
				) {
					chooserHeight = clamp(data.height, 180, 500);
					layoutSelection?.();
					return;
				}
				if (data.type === "storylens-selection-close") {
					close();
					return;
				}
				if (
					data.type !== "storylens-selection-create" ||
					!("kind" in data) ||
					!("novelId" in data) ||
					!("ai" in data)
				)
					return;
				if (
					(data.kind !== "keyword" &&
						data.kind !== "alias" &&
						data.kind !== "version") ||
					typeof data.novelId !== "string" ||
					typeof data.ai !== "boolean"
				)
					return;
				const extra: Record<string, string> = {
					create: data.kind,
					novelId: data.novelId,
				};
				if (data.kind !== "keyword") {
					if (!("parentId" in data) || typeof data.parentId !== "string")
						return;
					extra.parentId = data.parentId;
				}
				trackEvent("selection_create_requested", {
					kind: data.kind,
					ai: data.ai,
				});
				window.removeEventListener("message", receive);
				open(text, data.ai ? context : undefined, extra);
			};
			selectionMessageCleanup?.();
			selectionMessageCleanup = () =>
				window.removeEventListener("message", receive);
			window.addEventListener("message", receive);
		}, 0);
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Escape" && selecting) {
			close();
			return;
		}
		if (event.key === "Escape" && !panel.hidden) {
			close();
			button.focus();
		}
	};
	const onResize = () => {
		hideAction();
		setPosition(position);
	};
	const selectText = () => {
		close();
		selecting = true;
		updateHint();
		setPageSelectionUnlocked(true);
		hint.hidden = false;
		window.getSelection()?.removeAllRanges();
	};
	button.addEventListener("click", onButtonClick);
	button.addEventListener("pointerdown", onPointerDown);
	button.addEventListener("pointermove", onPointerMove);
	button.addEventListener("pointerup", onPointerEnd);
	button.addEventListener("pointercancel", onPointerEnd);
	button.addEventListener("focus", onButtonFocus);
	button.addEventListener("blur", onControlBlur);
	button.addEventListener("pointerenter", scheduleShowAction);
	button.addEventListener("pointerleave", scheduleHideAction);
	actions.addEventListener("pointerenter", clearActionTimer);
	actions.addEventListener("pointerleave", scheduleHideAction);
	actions.addEventListener("focusout", onControlBlur);
	action.addEventListener("click", onActionClick);
	summarizeAction.addEventListener("click", onSummarizeClick);
	extractAction.addEventListener("click", onExtractClick);
	const onStorageChange: Parameters<
		typeof browser.storage.onChanged.addListener
	>[0] = (changes, area) => {
		if (area !== "local" || !(DESKTOP_SETTINGS_KEY in changes)) return;
		desktop = parseDesktopSettings(changes[DESKTOP_SETTINGS_KEY].newValue);
		updateActionLabels();
	};
	browser.storage.onChanged.addListener(onStorageChange);
	document.addEventListener("pointermove", onCursorMove);
	document.documentElement.addEventListener("pointerleave", onCursorLeave);
	document.addEventListener("pointerdown", onPointerOutside);
	document.addEventListener("pointerup", onSelectionEnd);
	document.addEventListener("keydown", onKeyDown);
	window.addEventListener("resize", onResize);
	setPosition(position);
	void browser.storage.local
		.get([POSITION_KEY, DESKTOP_SETTINGS_KEY])
		.then((stored) => {
			if (!host.isConnected) return;
			desktop = parseDesktopSettings(stored[DESKTOP_SETTINGS_KEY]);
			updateActionLabels();
			if (!interacted) {
				const saved = storedPosition(stored[POSITION_KEY]);
				if (saved) setPosition(saved);
			}
		})
		.catch(() => {});
	return {
		host,
		setLocale: (nextLocale) => {
			currentLocale = nextLocale;
			if (!noticeTimer) updateHint();
			button.setAttribute("aria-label", labels(nextLocale).open);
			button.title = labels(nextLocale).open;
			panel.setAttribute("aria-label", labels(nextLocale).open);
			updateActionLabels();

			const frame = panel.querySelector("iframe");
			if (frame) frame.title = labels(nextLocale).open;
		},
		close,
		dispose: () => {
			close();
			browser.storage.onChanged.removeListener(onStorageChange);
			document.removeEventListener("pointermove", onCursorMove);
			document.documentElement.removeEventListener(
				"pointerleave",
				onCursorLeave,
			);
			document.removeEventListener("pointerdown", onPointerOutside);
			document.removeEventListener("pointerup", onSelectionEnd);
			document.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("resize", onResize);
			host.remove();
		},
	};
}

export function setPagePopupLauncher(visible: boolean, locale: string): void {
	if (!visible) {
		launcher?.dispose();
		launcher = undefined;
		return;
	}
	if (!launcher || !launcher.host.isConnected)
		launcher = createLauncher(locale);
	launcher.setLocale(locale);
}

export function closePagePopupLauncher(): void {
	launcher?.close();
}
