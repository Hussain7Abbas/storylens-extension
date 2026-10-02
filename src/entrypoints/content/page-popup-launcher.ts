import {
	CircleCheck,
	CircleX,
	createElement,
	House,
	type IconNode,
	ListFilter,
	LoaderCircle,
	Moon,
	Plus,
	SquarePen,
	Sun,
	TextSearch,
} from "lucide";
import { browser } from "#imports";
import { aiAvailability, availabilityKey } from "@/lib/ai-source/availability";
import {
	AI_SOURCE_KEY,
	type AiFeature,
	parseAiSource,
} from "@/lib/ai-source/source";
import { trackEvent } from "@/lib/analytics/client";
import { AUTH_STORAGE_KEY, parseStoredAuth } from "@/lib/auth/auth-storage";
import { AI_PRICING_KEY, type PricingCache } from "@/lib/billing/cache";
import { handleUnavailableAi } from "@/lib/cloud-ai/top-up";
import { vanillaAiText } from "@/lib/cloud-ai/vanilla-text";
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
	type AiTask,
	type AiTaskOperation,
	pageAiTasks,
} from "@/lib/launcher-frame/ai-tasks";
import {
	isPopupReady,
	POPUP_REQUEST_MESSAGE,
	POPUP_SHOWN_MESSAGE,
	type PopupRequest,
	parsePopupAnswer,
	parsePopupState,
	popupReadyKey,
} from "@/lib/launcher-frame/messages";
import { formatLenses, LENS_COIN_MONO } from "@/lib/lens-coin";
import {
	NIGHT_LIGHT_DEFAULT_LEVEL,
	NIGHT_LIGHT_ENABLED_KEY,
	NIGHT_LIGHT_LEVEL_KEY,
	parseNightLightLevel,
	setNightLightOverlay,
} from "@/lib/night-light";
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
// A finished summary or extraction stays listed this long; popup tasks stay until the popup opens.
const FINISHED_TASK_DURATION = 8000;
// A launcher near an edge stays visible this long after it appears, so readers notice it.
const LOAD_REVEAL_DURATION = 3000;
// A popup frame that has not announced itself by then failed to load.
const POPUP_READY_TIMEOUT = 5000;
// A form loading out of sight with no AI request started by then opens anyway.
const BACKGROUND_START_TIMEOUT = 8000;
// Popup tabs kept at once; each is a full popup document.
const MAX_POPUP_TABS = 6;
const FORM_TABS = [
	"create-keyword",
	"create-alias",
	"create-version",
	"edit-keyword",
	"edit-alias",
	"edit-version",
] as const;
type FormTab = (typeof FORM_TABS)[number];
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
/**
 * One popup document the launcher keeps, shown as a tab under its button. A
 * form requested while the shown tab holds work opens in a new tab, so several
 * AI requests (character details, images) can run at once.
 */
type PopupTab = {
	id: number;
	frame: HTMLIFrameElement;
	/** Announced by the popup document; its AI tasks carry it. */
	key?: string;
	/**
	 * The last state it reported. It lags behind the popup, so it drives the
	 * status dot, the tab and the unload guard; replacing or removing a tab is
	 * decided by its answer.
	 */
	state: { dirty: boolean; working: boolean };
	/** Whether its document announced itself, and when its frame started loading. */
	ready: boolean;
	started: number;
	/** The request it has not answered yet; a newer one replaces it. */
	request?: PopupRequest;
	/** How its AI request that ended out of sight turned out. */
	outcome?: "ready" | "failed";
	/** The page changed under it; it is removed once it holds no unsaved work. */
	stale: boolean;
	/** The form it was opened on and its text, named on the tab until an AI task does. */
	form?: FormTab;
	search: string;
	/**
	 * A text pick with AI loads its form out of sight: the tab's card shows a
	 * spinner under the button, and the tab opens by itself once the AI request
	 * ends (`finishBackground`). Cleared as soon as the tab is shown.
	 */
	background?: {
		/** Whether its AI request started (a task or a working state arrived). */
		started: boolean;
		timer: ReturnType<typeof setTimeout>;
	};
};

let launcher: Launcher | undefined;

function labels(locale: string): {
	home: string;
	forms: Record<FormTab, string>;
	tooManyTabs: string;
	taskDone: string;
	taskFailed: string;
	operations: Record<AiTaskOperation, string>;
	open: string;
	close: string;
	select: string;
	summarize: string;
	extract: string;
	nightLightOn: string;
	nightLightOff: string;
	configureAi: string;
	selectHint: string;
	working: string;
	ready: string;
	failed: string;
} {
	return locale.toLowerCase().startsWith("ar")
		? {
				home: "عدسة القصة",
				forms: {
					"create-keyword": "كلمة مفتاحية جديدة",
					"create-alias": "اسم مستعار جديد",
					"create-version": "نسخة جديدة",
					"edit-keyword": "تعديل كلمة مفتاحية",
					"edit-alias": "تعديل اسم مستعار",
					"edit-version": "تعديل نسخة",
				},
				tooManyTabs: "احفظ أحد النماذج المفتوحة أو أغلقه أولاً.",
				taskDone: "اكتملت",
				taskFailed: "فشلت",
				operations: {
					"suggest-keyword": "توليد الكلمة المفتاحية",
					"generate-image": "توليد الصورة",
					summarize: "تلخيص الصفحة",
					"extract-characters": "استخراج الشخصيات",
					"detect-selectors": "اكتشاف المحددات",
				},
				open: "افتح عدسة القصة",
				close: "إغلاق عدسة القصة",
				select: "حدد نصاً في الصفحة",
				summarize: "لخّص الصفحة بالذكاء الاصطناعي",
				extract: "استخرج شخصيات الفصل بالذكاء الاصطناعي",
				nightLightOn: "شغّل الإضاءة الليلية",
				nightLightOff: "أوقف الإضاءة الليلية",
				configureAi: "يرجى إعداد الذكاء الاصطناعي من الإعدادات.",
				selectHint: "انقر على كلمة أو اسحب لتحديد نص. اضغط Escape للإلغاء.",
				working: "الذكاء الاصطناعي يعمل",
				ready: "نتيجة الذكاء الاصطناعي جاهزة",
				failed: "فشل طلب الذكاء الاصطناعي",
			}
		: {
				home: "Story Lens",
				forms: {
					"create-keyword": "New keyword",
					"create-alias": "New alias",
					"create-version": "New version",
					"edit-keyword": "Edit keyword",
					"edit-alias": "Edit alias",
					"edit-version": "Edit version",
				},
				tooManyTabs: "Save or close one of the open forms first.",
				taskDone: "done",
				taskFailed: "failed",
				operations: {
					"suggest-keyword": "Generating keyword",
					"generate-image": "Generating image",
					summarize: "Summarizing page",
					"extract-characters": "Extracting characters",
					"detect-selectors": "Detecting selectors",
				},
				open: "Open Story Lens",
				close: "Close Story Lens",
				select: "Select text on page",
				summarize: "Summarize page with AI",
				extract: "Extract chapter characters with AI",
				nightLightOn: "Turn on night light",
				nightLightOff: "Turn off night light",
				configureAi: "Please configure AI in the settings.",
				selectHint:
					"Click a word or drag to select text. Press Escape to cancel.",
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
	let sourceValue: unknown;
	let auth = parseStoredAuth(undefined);
	let pricing: PricingCache | undefined;
	const availability = (feature: AiFeature) =>
		aiAvailability({
			source: parseAiSource(sourceValue, desktop),
			desktop,
			user: auth.user,
			pricing: pricing?.data ?? null,
			feature,
		});
	let nightLight = { enabled: false, level: NIGHT_LIGHT_DEFAULT_LEVEL };
	// A local click or storage event may arrive before the initial read resolves.
	let nightLightEnabledChanged = false;
	let nightLightLevelChanged = false;
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	let selectionStart: Position | undefined;
	let position: Position = { x: window.innerWidth - BUTTON_SIZE - 16, y: 16 };
	let interacted = false;
	let suppressClick = false;
	let cursor: Position | undefined;
	let revealed = false;
	let tucked = false;
	let loadReveal = true;
	let loadRevealTimer: ReturnType<typeof setTimeout> | undefined;
	let actionTimer: ReturnType<typeof setTimeout> | undefined;
	// Popup frames outlive closing, so open forms and their AI requests continue.
	let tabs: PopupTab[] = [];
	// The tab the panel shows and the launcher button opens.
	let active: PopupTab | undefined;
	let tabCount = 0;
	let chooserFrame: HTMLIFrameElement | undefined;
	let requests = 0;
	let taskTimer: ReturnType<typeof setTimeout> | undefined;
	const cards = new Map<string, HTMLElement>();
	// Whether leaving the page asks first; only while something would be lost.
	let guardingUnload = false;
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
		#tasks{position:absolute;display:flex;flex-direction:column;gap:6px;width:max-content;pointer-events:none}
		#tasks[hidden]{display:none}
		#tasks[data-side="below"]{top:calc(100% + ${GAP}px)}
		#tasks[data-side="below"][data-shifted]{top:calc(100% + ${GAP * 2 + ACTION_SIZE}px)}
		#tasks[data-side="above"]{bottom:calc(100% + ${GAP}px);flex-direction:column-reverse}
		#tasks[data-side="above"][data-shifted]{bottom:calc(100% + ${GAP * 2 + ACTION_SIZE}px)}
		#tasks[data-align="start"]{left:0;align-items:flex-start}
		#tasks[data-align="end"]{right:0;align-items:flex-end}
		.task{position:relative;display:flex;align-items:center;gap:8px;max-width:min(280px,calc(100vw - 32px));padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--ink);font:500 13px/1.3 system-ui,sans-serif;text-align:start;box-shadow:0 3px 10px rgb(32 33 50 / .25);box-sizing:border-box}
		button.task{pointer-events:auto;cursor:pointer}
		button.task:hover{background:var(--soft)}
		.task[aria-current="true"]{border-color:var(--accent);border-inline-start:3px solid var(--accent)}
		button.task:focus-visible{border-color:var(--accent);outline:3px solid var(--accent);outline-offset:2px}
		.task svg{flex:none;width:16px;height:16px}
		.task[data-state="working"] svg{color:var(--accent);animation:task-spin 1s linear infinite}
		.task[data-state="done"] svg{color:var(--success)}
		.task[data-state="failed"] svg{color:var(--error)}
		.task-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
		.task-state{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
		@keyframes task-spin{to{transform:rotate(360deg)}}
		@media(prefers-reduced-motion:reduce){.task[data-state] svg{animation:none}}
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
	const setActionIcon = (element: HTMLButtonElement, icon: IconNode) =>
		element.replaceChildren(
			createElement(icon, { "aria-hidden": "true", "stroke-width": 1.75 }),
		);
	const createAction = (name: string, icon: IconNode) => {
		const element = document.createElement("button");
		element.className = "action";
		element.dataset.action = name;
		element.type = "button";
		setActionIcon(element, icon);
		actions.append(element);
		return element;
	};
	const action = createAction("select", Plus);
	const summarizeAction = createAction("summarize", TextSearch);
	const extractAction = createAction("extract", ListFilter);
	const nightLightAction = createAction("night-light", Moon);
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
	// AI requests running in this tab, listed under the button without hovering it.
	const tasks = document.createElement("div");
	tasks.id = "tasks";
	tasks.hidden = true;
	tasks.setAttribute("aria-live", "polite");
	const updateHint = () => {
		const text = labels(currentLocale);
		hint.textContent = text.selectHint;
	};
	const updateActionLabels = () => {
		const text = labels(currentLocale);
		const describe = (
			element: HTMLButtonElement,
			label: string,
			feature?: AiFeature,
		) => {
			const value = feature ? availability(feature) : { ok: true as const };
			const unavailable = !value.ok;
			const reason = vanillaAiText(currentLocale)(availabilityKey(value));
			const price =
				feature && parseAiSource(sourceValue, desktop) === "cloud"
					? pricing?.data.features.find((row) => row.key === feature)?.lenses
					: undefined;
			element.querySelector(".lens-price")?.remove();
			if (price && price > 0) {
				const badge = document.createElement("span");
				badge.className = "lens-price";
				badge.setAttribute("aria-hidden", "true");
				badge.append(createElement(LENS_COIN_MONO, { "aria-hidden": "true" }));
				badge.append(formatLenses(price, currentLocale));
				element.style.position = "relative";
				badge.style.cssText =
					"position:absolute;inset-block-start:-5px;inset-inline-end:-5px;display:flex;align-items:center;gap:2px;background:var(--accent);color:var(--on-accent);border-radius:8px;padding:2px;font:10px system-ui;pointer-events:none";
				badge.querySelector("svg")?.setAttribute("width", "10");
				badge.querySelector("svg")?.setAttribute("height", "10");
				element.append(badge);
				label += `, ${vanillaAiText(currentLocale)("lens.count", { count: price, formatted: formatLenses(price, currentLocale) })}`;
			}
			element.setAttribute("aria-label", label);
			element.setAttribute("aria-disabled", String(unavailable));
			// Screen readers get the same reason as the hover tooltip.
			element.title = unavailable ? reason : label;
			if (unavailable) element.setAttribute("aria-description", reason);
			else element.removeAttribute("aria-description");
		};
		describe(action, text.select);
		describe(summarizeAction, text.summarize, "page_summary");
		describe(extractAction, text.extract, "chapter_extraction");
		describe(
			nightLightAction,
			nightLight.enabled ? text.nightLightOff : text.nightLightOn,
		);
	};
	/** Applies the night light to the page and shows on the action what a click does. */
	const updateNightLight = () => {
		setNightLightOverlay(nightLight.enabled, nightLight.level);
		setActionIcon(nightLightAction, nightLight.enabled ? Sun : Moon);
		updateActionLabels();
	};
	updateHint();
	updateActionLabels();
	shadow.append(style, button, actions, panel, hint, tasks);
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
		const contentWidth = Math.max(1, width - 2);
		const scale = Math.min(1, contentWidth / 384);
		for (const { frame } of tabs) {
			frame.style.width = `${Math.max(384, contentWidth)}px`;
			frame.style.height = `${Math.max(1, (height - 2) / scale)}px`;
			frame.style.transform = `scale(${scale})`;
		}
	};
	/** Opens `element` toward the larger half of the viewport so it stays visible. */
	const placeBesideButton = (element: HTMLElement) => {
		const size = button.offsetWidth || BUTTON_SIZE;
		element.dataset.side =
			position.y + size / 2 < window.innerHeight / 2 ? "below" : "above";
		element.dataset.align =
			position.x + size / 2 < window.innerWidth / 2 ? "start" : "end";
	};
	/** Keeps the task list on the actions' side, past the actions while they show. */
	const placeTasks = () => {
		placeBesideButton(tasks);
		tasks.toggleAttribute("data-shifted", !actions.hidden);
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
			loadReveal ||
			!!drag ||
			!panel.hidden ||
			!actions.hidden ||
			// A finished AI request brings the launcher back from the edge.
			tabs.some((tab) => tab.outcome !== undefined) ||
			// So does a listed AI task, which shows under the button.
			!tasks.hidden ||
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
		placeTasks();
		updateTuck();
	};
	const showAction = () => {
		clearActionTimer();
		if (drag || tucked || !panel.hidden || selecting) return;
		placeBesideButton(actions);
		actions.hidden = false;
		placeTasks();
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
	const desktopReady = (feature: AiFeature) => {
		const value = availability(feature);
		if (value.ok) return true;
		showNotice(vanillaAiText(currentLocale)(availabilityKey(value)));
		return false;
	};
	const onActionClick = () => {
		hideAction();
		selectText();
	};
	const onSummarizeClick = () => {
		if (!desktopReady("page_summary")) {
			handleUnavailableAi(availability("page_summary"));
			return;
		}
		hideAction();
		const result = startPageSummary({
			model: desktop.model,
			effort: desktop.effort,
			locale: currentLocale,
			source: parseAiSource(sourceValue, desktop),
			lenses: pricing?.data.features.find((row) => row.key === "page_summary")
				?.lenses,
		});
		if (result.started)
			trackEvent("ai_summary_requested", {
				provider: parseAiSource(sourceValue, desktop),
				...(parseAiSource(sourceValue, desktop) === "desktop"
					? { effort: desktop.effort }
					: {}),
			});
	};
	const onExtractClick = () => {
		if (!desktopReady("chapter_extraction")) {
			handleUnavailableAi(availability("chapter_extraction"));
			return;
		}
		hideAction();
		// The embedded extraction page runs the AI request and tracks it.
		startChapterExtraction(currentLocale);
	};
	// A toggle keeps the action row open, so the reader can switch it back.
	const onNightLightClick = () => {
		nightLightEnabledChanged = true;
		nightLight = { ...nightLight, enabled: !nightLight.enabled };
		updateNightLight();
		void browser.storage.local
			.set({ [NIGHT_LIGHT_ENABLED_KEY]: nightLight.enabled })
			.catch(() => {});
		trackEvent("night_light_toggled", { enabled: nightLight.enabled });
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
		placeTasks();
		updateTuck();
		layoutPopup();
	};
	let selectionMessageCleanup: (() => void) | undefined;
	const tabVisible = (tab: PopupTab) =>
		!panel.hidden && tab === active && !tab.frame.hidden;
	const popupVisible = () => !!active && tabVisible(active);
	/** The AI tasks of a tab's document; tasks from an unknown document belong to none. */
	const ofTab = (tab: PopupTab) => (task: AiTask) =>
		task.source === "popup" && !!tab.key && task.frame === tab.key;
	const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
	/**
	 * Asks before the page is left while an AI request runs or a form or AI
	 * result is unsaved; the listener exists only then, so the page otherwise
	 * keeps its back/forward cache.
	 */
	const updateUnloadGuard = () => {
		const guard = tabs.some((tab) => tab.state.dirty) || pageAiTasks.unsaved();
		if (guard === guardingUnload) return;
		guardingUnload = guard;
		if (guard) window.addEventListener("beforeunload", onBeforeUnload);
		else window.removeEventListener("beforeunload", onBeforeUnload);
	};
	const isPageTaskExpired = (task: AiTask, now: number) =>
		task.source !== "popup" &&
		task.finishedAt !== undefined &&
		task.finishedAt + FINISHED_TASK_DURATION <= now;
	/** Removes a finished summary or extraction from the list after a while. */
	const scheduleTaskSweep = () => {
		clearTimeout(taskTimer);
		taskTimer = undefined;
		const ends = pageAiTasks
			.shown()
			.flatMap((task) =>
				task.source !== "popup" && task.finishedAt !== undefined
					? [task.finishedAt + FINISHED_TASK_DURATION]
					: [],
			);
		if (!ends.length) return;
		taskTimer = setTimeout(
			() => {
				taskTimer = undefined;
				const now = Date.now();
				pageAiTasks.dismiss((task) => isPageTaskExpired(task, now));
				scheduleTaskSweep();
			},
			Math.max(0, Math.min(...ends) - Date.now()),
		);
	};
	const taskIcons: Record<AiTask["state"], IconNode> = {
		working: LoaderCircle,
		done: CircleCheck,
		failed: CircleX,
	};
	type Card = {
		key: string;
		line: string;
		icon: IconNode;
		state: AiTask["state"] | "idle";
		current?: boolean;
		onClick?: () => void;
	};
	/** Fills a card; it is rebuilt only when what it shows changed. */
	const renderCard = (card: Card) => {
		const text = labels(currentLocale);
		let row = cards.get(card.key);
		const clickable = !!card.onClick;
		if (!row || row instanceof HTMLButtonElement !== clickable) {
			row = document.createElement(clickable ? "button" : "div");
			row.className = "task";
			if (row instanceof HTMLButtonElement) row.type = "button";
			cards.set(card.key, row);
		}
		if (row instanceof HTMLButtonElement) row.onclick = card.onClick ?? null;
		const state =
			card.state === "done"
				? text.taskDone
				: card.state === "failed"
					? text.taskFailed
					: "";
		// Each card reads in the launcher language; the list keeps its physical side.
		row.dir = currentLocale.toLowerCase().startsWith("ar") ? "rtl" : "ltr";
		if (card.current) row.setAttribute("aria-current", "true");
		else row.removeAttribute("aria-current");
		if (row.dataset.state !== card.state || row.dataset.line !== card.line) {
			row.dataset.state = card.state;
			row.dataset.line = card.line;
			const label = document.createElement("span");
			label.className = "task-text";
			label.textContent = card.line;
			const announced = document.createElement("span");
			announced.className = "task-state";
			announced.textContent = state ? ` (${state})` : "";
			row.replaceChildren(
				createElement(card.icon, {
					"aria-hidden": "true",
					"stroke-width": 1.75,
				}),
				label,
				announced,
			);
			row.title = state ? `${card.line} (${state})` : card.line;
		}
		return row;
	};
	const taskLine = (task: AiTask) => {
		const name = labels(currentLocale).operations[task.operation];
		return task.subject ? `${task.subject} - ${name}` : name;
	};
	/** A popup tab's card: its latest AI task, or the form it was opened on. */
	const tabCard = (tab: PopupTab, shown: AiTask[]): Card => {
		const text = labels(currentLocale);
		const own = shown.filter(ofTab(tab));
		const latest = own.at(-1);
		const select = () => {
			interacted = true;
			openTab(tab);
		};
		if (latest)
			return {
				key: `tab-${tab.id}`,
				line: taskLine(latest),
				icon: own.some((task) => task.state === "working")
					? taskIcons.working
					: taskIcons[latest.state],
				state: own.some((task) => task.state === "working")
					? "working"
					: latest.state,
				current: tab === active,
				onClick: select,
			};
		if (tab.background)
			return {
				key: `tab-${tab.id}`,
				line: tab.search
					? `${tab.search} - ${text.operations["suggest-keyword"]}`
					: text.operations["suggest-keyword"],
				icon: taskIcons.working,
				state: "working",
				current: false,
				onClick: select,
			};
		const name = tab.form ? text.forms[tab.form] : text.home;
		return {
			key: `tab-${tab.id}`,
			line: tab.form && tab.search ? `${tab.search} - ${name}` : name,
			icon: tab.form ? SquarePen : House,
			state: "idle",
			current: tab === active,
			onClick: select,
		};
	};
	/**
	 * Lists the popup tabs and the page's AI tasks under the button while the
	 * panel is closed. With one tab, it shows only while it has AI tasks.
	 */
	const renderTasks = () => {
		// The shown tab's requests are on screen, so their results were seen.
		if (active && popupVisible()) pageAiTasks.dismiss(ofTab(active));
		const shown = pageAiTasks.shown();
		const list: Card[] = [];
		for (const tab of tabs)
			if (tabs.length > 1 || tab.background || shown.some(ofTab(tab)))
				list.push(tabCard(tab, shown));
		for (const task of shown) {
			if (task.source === "popup" && tabs.some((tab) => ofTab(tab)(task)))
				continue;
			// A popup task from a document the launcher has no key for opens the shown tab.
			list.push({
				key: task.id,
				line: taskLine(task),
				icon: taskIcons[task.state],
				state: task.state,
				onClick:
					task.source === "popup"
						? () => {
								interacted = true;
								open();
							}
						: undefined,
			});
		}
		const rows = list.map(renderCard);
		for (const key of cards.keys())
			if (!list.some((card) => card.key === key)) cards.delete(key);
		if (
			rows.length !== tasks.children.length ||
			rows.some((row, index) => tasks.children[index] !== row)
		)
			tasks.replaceChildren(...rows);
		tasks.hidden = !rows.length || !panel.hidden;
		placeTasks();
		scheduleTaskSweep();
		updateUnloadGuard();
		updateTuck();
	};
	/** Shows the state of out-of-sight popup tabs on the button and in its label. */
	const updateStatus = () => {
		const text = labels(currentLocale);
		const hidden = tabs.filter((tab) => !tabVisible(tab));
		const state: Status | undefined = hidden.some((tab) => tab.state.working)
			? "working"
			: hidden.some((tab) => tab.outcome === "failed")
				? "failed"
				: hidden.some((tab) => tab.outcome === "ready")
					? "ready"
					: undefined;
		status.hidden = !state;
		if (state) status.dataset.state = state;
		else delete status.dataset.state;
		const label = state ? `${text.open} (${text[state]})` : text.open;
		button.setAttribute("aria-label", label);
		button.title = label;
		renderTasks();
	};
	const createFrame = (query: string) => {
		const frame = document.createElement("iframe");
		frame.title = labels(currentLocale).open;
		frame.src = popupUrl + (query ? `?${query}` : "");
		return frame;
	};
	/** The form a query asks for, which names its tab. */
	const formOf = (query: string): Pick<PopupTab, "form" | "search"> => {
		const params = new URLSearchParams(query);
		const kind = params.has("edit") ? "edit" : "create";
		const form = `${kind}-${params.get(kind)}`;
		return {
			form: FORM_TABS.find((name) => name === form),
			search: params.get("search")?.trim() ?? "",
		};
	};
	const createTab = (query: string) => {
		tabCount += 1;
		const tab: PopupTab = {
			id: tabCount,
			frame: createFrame(query),
			state: { dirty: false, working: false },
			ready: false,
			started: Date.now(),
			stale: false,
			...formOf(query),
		};
		tabs.push(tab);
		panel.append(tab.frame);
		return tab;
	};
	/** Puts `tab` in the panel; the other tabs stay loaded out of sight. */
	const showTab = (tab: PopupTab) => {
		if (active && active !== tab && shadow.activeElement === active.frame)
			active.frame.blur();
		active = tab;
		for (const other of tabs) other.frame.hidden = other !== tab;
		tab.outcome = undefined;
		// Shown before its AI request ended: it must not open again by itself.
		clearTimeout(tab.background?.timer);
		tab.background = undefined;
	};
	const discardTab = (tab: PopupTab) => {
		clearTimeout(tab.background?.timer);
		tab.background = undefined;
		tab.frame.remove();
		tabs = tabs.filter((other) => other !== tab);
		// The tab's requests and results go with its document.
		if (tab.key) pageAiTasks.drop(ofTab(tab));
		if (active === tab) active = tabs.at(-1);
	};
	const sendRequest = (tab: PopupTab) => {
		// A frame that is still loading gets the request once it announces itself.
		if (!tab.ready || !tab.request) return;
		tab.frame.contentWindow?.postMessage(
			{ type: POPUP_REQUEST_MESSAGE, ...tab.request },
			popupOrigin,
		);
	};
	/**
	 * Asks a tab to load `query` (`reload`), or whether it can be removed.
	 * Only the popup knows its unsaved work at this moment, so nothing is
	 * replaced or removed until it answers.
	 */
	const ask = (tab: PopupTab, query: string, reload: boolean) => {
		requests += 1;
		tab.request = { id: String(requests), query, reload };
		sendRequest(tab);
	};
	/**
	 * Asks the tabs out of sight that may hold nothing whether they can go:
	 * every tab but the shown one, and the shown one after an in-site
	 * navigation. A tab whose AI result was not looked at stays. `closing`
	 * also asks tabs whose late state still says they hold work.
	 */
	const collectTabs = (closing = false) => {
		for (const tab of tabs) {
			if (tabVisible(tab) || tab.request || !tab.ready || tab.background)
				continue;
			if (tab === active && !tab.stale) continue;
			if (tab.state.dirty && !closing) continue;
			if (pageAiTasks.some(ofTab(tab))) continue;
			ask(tab, "", false);
		}
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
	const showPanel = () => {
		panel.hidden = false;
		button.setAttribute("aria-expanded", "true");
		updateStatus();
		updateTuck();
		layoutPopup();
	};
	/** Hides the panel; the popup frames stay loaded so their state survives. */
	const close = () => {
		stopPicking();
		// A hidden frame must not keep the keyboard from the page.
		if (active && shadow.activeElement === active.frame) active.frame.blur();
		panel.hidden = true;
		button.setAttribute("aria-expanded", "false");
		collectTabs(true);
		updateStatus();
		updateTuck();
	};
	/** Shows a kept tab as it was. */
	const openTab = (tab: PopupTab) => {
		stopPicking();
		const previous = active;
		showTab(tab);
		tab.frame.contentWindow?.postMessage(
			{ type: POPUP_SHOWN_MESSAGE },
			popupOrigin,
		);
		showPanel();
		if (previous !== tab) collectTabs();
	};
	/** The popup query of a requested form. */
	const formQuery = (
		search?: string,
		context?: KeywordContext,
		extra?: Record<string, string>,
	) => {
		const params = new URLSearchParams(extra);
		if (search) params.set("search", search);
		// The popup reads this hidden context to request AI keyword suggestions.
		if (context)
			params.set(KEYWORD_CONTEXT_PARAM, encodeKeywordContext(context));
		return params.toString();
	};
	/**
	 * Shows the popup. Parameters name a form to open: the shown tab loads it
	 * itself unless it holds unsaved work, and then it opens in a new tab.
	 */
	const open = (
		search?: string,
		context?: KeywordContext,
		extra?: Record<string, string>,
	) => {
		stopPicking();
		const query = formQuery(search, context, extra);
		// A frame that never loaded holds nothing and would never answer.
		for (const tab of [...tabs])
			if (!tab.ready && Date.now() - tab.started > POPUP_READY_TIMEOUT)
				discardTab(tab);
		if (!active) {
			showTab(createTab(query));
			showPanel();
			return;
		}
		if (!query) {
			openTab(active);
			return;
		}
		if (active.state.dirty && tabs.length < MAX_POPUP_TABS)
			// Known to hold work: a new tab replaces nothing.
			showTab(createTab(query));
		else {
			showTab(active);
			ask(active, query, true);
		}
		showPanel();
	};
	/**
	 * An AI-assisted form from a text pick loads in a new tab out of sight, so
	 * the reader keeps reading while its card under the button shows progress.
	 * Returns false at the tab limit, where the form opens the usual way.
	 */
	const openInBackground = (
		search: string,
		context: KeywordContext,
		extra: Record<string, string>,
	): boolean => {
		if (tabs.length >= MAX_POPUP_TABS) return false;
		close();
		const tab = createTab(formQuery(search, context, extra));
		tab.frame.hidden = true;
		tab.background = {
			started: false,
			// A form that never starts its request (it could not, or it failed to load) opens anyway.
			timer: setTimeout(() => {
				if (tab.background && !tab.background.started) finishBackground(tab);
			}, BACKGROUND_START_TIMEOUT),
		};
		// With no other tab, the button opens this one, as it is.
		active ??= tab;
		updateStatus();
		return true;
	};
	/**
	 * A background tab's AI request ended: it opens by itself unless the reader
	 * is using a popup, the chooser or the text picker; then its card stays.
	 */
	const finishBackground = (tab: PopupTab) => {
		if (!tab.background) return;
		clearTimeout(tab.background.timer);
		tab.background = undefined;
		if (!tabs.includes(tab)) return;
		if (panel.hidden && !selecting && !chooserFrame) openTab(tab);
		else {
			tab.outcome ??= "ready";
			updateStatus();
		}
	};
	/** Follows background tabs' AI tasks: started, then ended (done or failed). */
	const checkBackgroundTabs = () => {
		const shown = pageAiTasks.shown();
		for (const tab of [...tabs]) {
			if (!tab.background) continue;
			const own = shown.filter(ofTab(tab));
			if (own.length) tab.background.started = true;
			if (
				tab.background.started &&
				!tab.state.working &&
				!own.some((task) => task.state === "working")
			)
				finishBackground(tab);
		}
	};
	/** Shows the Keyword/Alias/Version chooser in its own frame, beside the kept tabs. */
	const openChooser = (text: string) => {
		stopPicking();
		const frame = createFrame(
			new URLSearchParams({ view: "selection", search: text }).toString(),
		);
		chooserFrame = frame;
		for (const tab of tabs) tab.frame.hidden = true;
		panel.append(frame);
		panel.hidden = false;
		button.setAttribute("aria-expanded", "true");
		updateStatus();
		updateTuck();
		return frame;
	};
	const onPopupAnswer = (
		tab: PopupTab,
		kept: boolean,
		request: PopupRequest,
	) => {
		if (kept) {
			if (!request.reload) return;
			// The tab holds work, so the requested form opens in a tab of its own.
			if (tabs.length >= MAX_POPUP_TABS) {
				showNotice(labels(currentLocale).tooManyTabs);
				return;
			}
			// It becomes the shown tab even if the panel closed meanwhile, so it is not collected.
			showTab(createTab(request.query));
			layoutPopup();
		} else if (request.reload) {
			// The tab is loading the requested form in the same frame.
			if (tab.key) pageAiTasks.drop(ofTab(tab));
			Object.assign(tab, {
				key: undefined,
				state: { dirty: false, working: false },
				ready: false,
				started: Date.now(),
				outcome: undefined,
				stale: false,
				...formOf(request.query),
			});
		} else if (!tabVisible(tab)) discardTab(tab);
	};
	const onPopupMessage = (message: MessageEvent) => {
		const tab = tabs.find(
			(candidate) =>
				!!message.source && message.source === candidate.frame.contentWindow,
		);
		if (!tab || message.origin !== popupOrigin) return;
		const answer = parsePopupAnswer(message.data);
		const next = parsePopupState(message.data);
		if (answer) {
			const request = tab.request;
			if (answer.id !== request?.id) return;
			tab.request = undefined;
			onPopupAnswer(tab, answer.kept, request);
		} else if (isPopupReady(message.data)) {
			// A freshly loaded popup document holds nothing yet.
			const key = popupReadyKey(message.data);
			if (tab.key && tab.key !== key) {
				// An iframe can reload itself (for example after saving selectors).
				pageAiTasks.drop(ofTab(tab));
				tab.outcome = undefined;
			}
			tab.ready = true;
			tab.key = key;
			tab.state = { dirty: false, working: false };
			sendRequest(tab);
		} else if (next) {
			const finished = tab.state.working && !next.working;
			tab.state = { dirty: next.dirty, working: next.working };
			if (finished && !tabVisible(tab))
				tab.outcome = next.failed ? "failed" : "ready";
			if (next.working && tab.background) tab.background.started = true;
			if (!next.dirty) collectTabs();
		} else return;
		updateStatus();
		updateTuck();
		checkBackgroundTabs();
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
				// The form waits for its AI answer out of sight, then opens.
				if (data.ai && context && openInBackground(text, context, extra))
					return;
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
	nightLightAction.addEventListener("click", onNightLightClick);
	const onStorageChange: Parameters<
		typeof browser.storage.onChanged.addListener
	>[0] = (changes, area) => {
		if (area !== "local") return;
		if (AI_SOURCE_KEY in changes) sourceValue = changes[AI_SOURCE_KEY].newValue;
		if (AUTH_STORAGE_KEY in changes)
			auth = parseStoredAuth(changes[AUTH_STORAGE_KEY].newValue);
		if (AI_PRICING_KEY in changes)
			pricing = changes[AI_PRICING_KEY].newValue as PricingCache | undefined;
		if (
			[AI_SOURCE_KEY, AUTH_STORAGE_KEY, AI_PRICING_KEY].some(
				(key) => key in changes,
			)
		)
			updateActionLabels();
		if (DESKTOP_SETTINGS_KEY in changes) {
			desktop = parseDesktopSettings(changes[DESKTOP_SETTINGS_KEY].newValue);
			updateActionLabels();
		}
		// Another tab's toggle and the Appearance level apply here at once.
		if (
			NIGHT_LIGHT_ENABLED_KEY in changes ||
			NIGHT_LIGHT_LEVEL_KEY in changes
		) {
			if (NIGHT_LIGHT_ENABLED_KEY in changes) {
				nightLightEnabledChanged = true;
				nightLight.enabled = changes[NIGHT_LIGHT_ENABLED_KEY].newValue === true;
			}
			if (NIGHT_LIGHT_LEVEL_KEY in changes) {
				nightLightLevelChanged = true;
				nightLight.level = parseNightLightLevel(
					changes[NIGHT_LIGHT_LEVEL_KEY].newValue,
				);
			}
			updateNightLight();
		}
	};
	browser.storage.onChanged.addListener(onStorageChange);
	document.addEventListener("pointermove", onCursorMove);
	document.documentElement.addEventListener("pointerleave", onCursorLeave);
	document.addEventListener("pointerdown", onPointerOutside);
	document.addEventListener("pointerup", onSelectionEnd);
	document.addEventListener("keydown", onKeyDown);
	window.addEventListener("resize", onResize);
	window.addEventListener("message", onPopupMessage);
	const unsubscribeTasks = pageAiTasks.subscribe(renderTasks);
	const unsubscribeBackground = pageAiTasks.subscribe(checkBackgroundTabs);
	setPosition(position);
	renderTasks();
	loadRevealTimer = setTimeout(() => {
		loadRevealTimer = undefined;
		loadReveal = false;
		updateTuck();
	}, LOAD_REVEAL_DURATION);
	void browser.storage.local
		.get([
			POSITION_KEY,
			DESKTOP_SETTINGS_KEY,
			AI_SOURCE_KEY,
			AUTH_STORAGE_KEY,
			AI_PRICING_KEY,
			NIGHT_LIGHT_ENABLED_KEY,
			NIGHT_LIGHT_LEVEL_KEY,
		])
		.then((stored) => {
			if (!host.isConnected) return;
			desktop = parseDesktopSettings(stored[DESKTOP_SETTINGS_KEY]);
			sourceValue = stored[AI_SOURCE_KEY];
			auth = parseStoredAuth(stored[AUTH_STORAGE_KEY]);
			pricing = stored[AI_PRICING_KEY] as PricingCache | undefined;
			updateActionLabels();
			nightLight = {
				enabled: nightLightEnabledChanged
					? nightLight.enabled
					: stored[NIGHT_LIGHT_ENABLED_KEY] === true,
				level: nightLightLevelChanged
					? nightLight.level
					: parseNightLightLevel(stored[NIGHT_LIGHT_LEVEL_KEY]),
			};
			updateNightLight();
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
			for (const frame of [...tabs.map((tab) => tab.frame), chooserFrame])
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
			for (const tab of tabs) tab.stale = true;
			close();
		},
		dispose: () => {
			clearTimeout(loadRevealTimer);
			unsubscribeTasks();
			unsubscribeBackground();
			clearTimeout(taskTimer);
			close();
			for (const tab of [...tabs]) discardTab(tab);
			window.removeEventListener("beforeunload", onBeforeUnload);
			// The layer goes with the launcher, which holds its only switch.
			setNightLightOverlay(false, nightLight.level);
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
