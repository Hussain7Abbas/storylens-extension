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
import {
	isPopupReady,
	POPUP_REQUEST_MESSAGE,
	POPUP_SHOWN_MESSAGE,
	type PopupRequest,
	parsePopupAnswer,
	parsePopupState,
} from "@/lib/launcher-frame/messages";
import { contentThemeCss, palette } from "@/styles/palette";
import {
	setTooltipActions,
	type TooltipEditTarget,
} from "@/utils/keyword-tooltip";
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
// A popup frame that has not announced itself by then failed to load.
const POPUP_READY_TIMEOUT = 5000;
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
	edit: (target: TooltipEditTarget) => void;
	navigated: () => void;
	dispose: () => void;
};
/** What the launcher button shows about a popup that is out of sight. */
type Status = "working" | "ready" | "failed";

let launcher: Launcher | undefined;

function labels(locale: string): {
	open: string;
	close: string;
	select: string;
	summarize: string;
	extract: string;
	configureAi: string;
	selectHint: string;
	finishForm: string;
	working: string;
	ready: string;
	failed: string;
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
				finishForm: "احفظ النموذج المفتوح أو أغلقه أولاً.",
				working: "الذكاء الاصطناعي يعمل",
				ready: "نتيجة الذكاء الاصطناعي جاهزة",
				failed: "فشل طلب الذكاء الاصطناعي",
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
				finishForm: "Save or close the open form first.",
				working: "AI is working",
				ready: "AI result is ready",
				failed: "AI request failed",
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
	// The popup frame outlives closing, so an open form and its AI request continue.
	let popupFrame: HTMLIFrameElement | undefined;
	let chooserFrame: HTMLIFrameElement | undefined;
	// The last state the popup reported. It lags behind the popup, so it drives
	// the status dot only; replacing the popup is decided by the popup's answer.
	let popupState = { dirty: false, working: false };
	// Whether the popup document announced itself, and when its frame started loading.
	let popupReady = false;
	let popupStarted = 0;
	// The request the popup has not answered yet; a newer one replaces it.
	let request: PopupRequest | undefined;
	let requests = 0;
	// How the AI request that ended while the popup was out of sight turned out.
	let outcome: "ready" | "failed" | undefined;
	// The page changed under a kept popup; it is removed once it holds no unsaved work.
	let stale = false;
	const popupUrl = browser.runtime.getURL("/popup.html");
	const popupOrigin = new URL(popupUrl).origin;
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
		#launcher{position:relative;display:grid;place-items:center;width:100%;height:100%;padding:2px;border:1px solid var(--border);border-radius:50%;background:var(--surface);box-shadow:0 3px 14px rgb(32 33 50 / .35);touch-action:none;user-select:none;box-sizing:border-box;transition:transform 180ms ease}
		#status{position:absolute;top:0;inset-inline-end:0;width:14px;height:14px;border:2px solid var(--surface);border-radius:50%;box-sizing:border-box;pointer-events:none}
		#status[hidden]{display:none}
		#status[data-state="working"]{background:var(--accent);animation:status-pulse 1.2s ease-in-out infinite}
		#status[data-state="ready"]{background:var(--success)}
		#status[data-state="failed"]{background:var(--error)}
		@keyframes status-pulse{50%{opacity:.3}}
		@media(prefers-reduced-motion:reduce){#launcher{transition:none}#status{animation:none}}
		#launcher:hover,#launcher:focus-visible{border-color:var(--accent);outline:3px solid var(--accent);outline-offset:2px}
		#logo{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none}
		#panel{position:fixed;box-sizing:border-box;border:1px solid var(--border);border-radius:12px;background:var(--paper);box-shadow:0 24px 80px rgb(32 33 50 / .25);overflow:hidden}
		#panel[hidden]{display:none}
		iframe{display:block;border:0;background:var(--paper);transform-origin:top left}
		iframe[hidden]{display:none}
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
	const status = document.createElement("span");
	status.id = "status";
	status.hidden = true;
	status.setAttribute("aria-hidden", "true");
	button.append(logo, status);
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
		const frame = popupFrame;
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
			// A finished AI request brings the launcher back from the edge.
			outcome !== undefined ||
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
	const popupVisible = () =>
		!panel.hidden && !!popupFrame && !popupFrame.hidden;
	/** Shows the state of an out-of-sight popup on the button and in its label. */
	const updateStatus = () => {
		const text = labels(currentLocale);
		const state: Status | undefined = popupVisible()
			? undefined
			: popupState.working
				? "working"
				: outcome;
		status.hidden = !state;
		if (state) status.dataset.state = state;
		else delete status.dataset.state;
		const label = state ? `${text.open} (${text[state]})` : text.open;
		button.setAttribute("aria-label", label);
		button.title = label;
	};
	const createFrame = (query: string) => {
		const frame = document.createElement("iframe");
		frame.title = labels(currentLocale).open;
		frame.src = popupUrl + (query ? `?${query}` : "");
		return frame;
	};
	const discardPopup = () => {
		popupFrame?.remove();
		popupFrame = undefined;
		popupState = { dirty: false, working: false };
		popupReady = false;
		request = undefined;
		outcome = undefined;
		stale = false;
	};
	const sendRequest = () => {
		// A frame that is still loading gets the request once it announces itself.
		if (!popupFrame || !popupReady || !request) return;
		popupFrame.contentWindow?.postMessage(
			{ type: POPUP_REQUEST_MESSAGE, ...request },
			popupOrigin,
		);
	};
	/**
	 * Asks the popup to load `query` (`reload`), or whether it can be removed.
	 * Only the popup knows its unsaved work at this moment, so nothing is
	 * replaced until it answers.
	 */
	const ask = (query: string, reload: boolean) => {
		requests += 1;
		request = { id: String(requests), query, reload };
		sendRequest();
	};
	const removeChooser = () => {
		selectionMessageCleanup?.();
		selectionMessageCleanup = undefined;
		layoutSelection = undefined;
		chooserFrame?.remove();
		chooserFrame = undefined;
	};
	const stopPicking = () => {
		removeChooser();
		hideAction();
		clearNotice();
		selecting = false;
		setPageSelectionUnlocked(false);
		hint.hidden = true;
		selectionStart = undefined;
	};
	/** Hides the panel; the popup frame stays loaded so its state survives. */
	const close = () => {
		stopPicking();
		// A hidden frame must not keep the keyboard from the page.
		if (popupFrame && shadow.activeElement === popupFrame) popupFrame.blur();
		panel.hidden = true;
		button.setAttribute("aria-expanded", "false");
		if (stale) ask("", false);
		updateStatus();
		updateTuck();
	};
	/**
	 * Shows the popup. Parameters name a form to open: the kept popup loads it
	 * itself, unless it holds unsaved work, which it answers instead.
	 */
	const open = (
		search?: string,
		context?: KeywordContext,
		extra?: Record<string, string>,
	) => {
		stopPicking();
		const params = new URLSearchParams(extra);
		if (search) params.set("search", search);
		// The popup reads this hidden context to request AI keyword suggestions.
		if (context)
			params.set(KEYWORD_CONTEXT_PARAM, encodeKeywordContext(context));
		const query = params.toString();
		// A frame that never loaded holds nothing and would never answer.
		if (
			popupFrame &&
			!popupReady &&
			Date.now() - popupStarted > POPUP_READY_TIMEOUT
		)
			discardPopup();
		if (!popupFrame) {
			popupFrame = createFrame(query);
			popupStarted = Date.now();
			panel.append(popupFrame);
		} else {
			popupFrame.hidden = false;
			if (query) ask(query, true);
			else
				popupFrame.contentWindow?.postMessage(
					{ type: POPUP_SHOWN_MESSAGE },
					popupOrigin,
				);
		}
		outcome = undefined;
		panel.hidden = false;
		button.setAttribute("aria-expanded", "true");
		updateStatus();
		updateTuck();
		layoutPopup();
	};
	/** Shows the Keyword/Alias/Version chooser in its own frame, beside the kept popup. */
	const openChooser = (text: string) => {
		stopPicking();
		const frame = createFrame(
			new URLSearchParams({ view: "selection", search: text }).toString(),
		);
		chooserFrame = frame;
		if (popupFrame) popupFrame.hidden = true;
		panel.append(frame);
		panel.hidden = false;
		button.setAttribute("aria-expanded", "true");
		updateStatus();
		updateTuck();
		return frame;
	};
	const onPopupAnswer = (kept: boolean, reload: boolean) => {
		if (kept) {
			if (reload) showNotice(labels(currentLocale).finishForm);
		} else if (reload) {
			// The popup is loading the requested form in the same frame.
			popupState = { dirty: false, working: false };
			popupReady = false;
			popupStarted = Date.now();
			outcome = undefined;
			stale = false;
		} else if (!popupVisible()) discardPopup();
	};
	const onPopupMessage = (message: MessageEvent) => {
		if (
			!popupFrame ||
			!message.source ||
			message.source !== popupFrame.contentWindow ||
			message.origin !== popupOrigin
		)
			return;
		const answer = parsePopupAnswer(message.data);
		const next = parsePopupState(message.data);
		if (answer) {
			if (answer.id !== request?.id) return;
			const { reload } = request;
			request = undefined;
			onPopupAnswer(answer.kept, reload);
		} else if (isPopupReady(message.data)) {
			// A freshly loaded popup document holds nothing yet.
			popupReady = true;
			popupState = { dirty: false, working: false };
			sendRequest();
		} else if (next) {
			const finished = popupState.working && !next.working;
			popupState = { dirty: next.dirty, working: next.working };
			if (finished && !popupVisible())
				outcome = next.failed ? "failed" : "ready";
			if (stale && !next.dirty && !popupVisible()) ask("", false);
		} else return;
		updateStatus();
		updateTuck();
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
			const chooser = openChooser(text);
			let chooserHeight = 300;
			layoutSelection = () => {
				const width = Math.min(390, window.innerWidth - EDGE * 2);
				const height = Math.min(chooserHeight, window.innerHeight - EDGE * 2);
				panel.style.width = `${width}px`;
				panel.style.height = `${height}px`;
				panel.style.left = `${clamp((rect?.left ?? event.clientX) + (rect?.width ?? 0) / 2 - width / 2, EDGE, window.innerWidth - width - EDGE)}px`;
				panel.style.top = `${clamp((rect?.top ?? event.clientY) - height - GAP, EDGE, window.innerHeight - height - EDGE)}px`;
				chooser.style.width = "100%";
				chooser.style.height = "100%";
				chooser.style.transform = "none";
			};
			layoutSelection();
			const receive = (message: MessageEvent) => {
				if (
					message.source !== chooser.contentWindow ||
					message.origin !== popupOrigin
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
	window.addEventListener("message", onPopupMessage);
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
			updateStatus();
			panel.setAttribute("aria-label", labels(nextLocale).open);
			updateActionLabels();
			for (const frame of [popupFrame, chooserFrame])
				if (frame) frame.title = labels(nextLocale).open;
		},
		// The popup opens the form of the entry named by these parameters.
		edit: (target) =>
			open(undefined, undefined, {
				edit: target.kind,
				id: target.id,
				parentId: target.keywordId,
				novelId: target.novelId,
			}),
		// An in-site navigation: a popup without unsaved work is removed, so the next one detects the new page.
		navigated: () => {
			stale = !!popupFrame;
			close();
		},
		dispose: () => {
			close();
			discardPopup();
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
			window.removeEventListener("message", onPopupMessage);
			host.remove();
		},
	};
}

/** Opens the launcher popup on the edit form of a keyword, alias or version. */
function openPagePopupEditor(target: TooltipEditTarget): void {
	if (!launcher?.host.isConnected) return;
	launcher.edit(target);
	trackEvent("tooltip_edit_requested", { kind: target.kind });
}

function trackTooltipImage(): void {
	trackEvent("tooltip_image_opened");
}

export function setPagePopupLauncher(visible: boolean, locale: string): void {
	if (!visible) {
		launcher?.dispose();
		launcher = undefined;
		// Keyword tooltips offer Edit only while the launcher can open the form.
		setTooltipActions({ onImageOpen: trackTooltipImage });
		return;
	}
	if (!launcher || !launcher.host.isConnected)
		launcher = createLauncher(locale);
	launcher.setLocale(locale);
	setTooltipActions({
		onEdit: openPagePopupEditor,
		onImageOpen: trackTooltipImage,
	});
}

/** Hides the launcher popup after the page changed without a reload. */
export function pagePopupLauncherNavigated(): void {
	launcher?.navigated();
}
