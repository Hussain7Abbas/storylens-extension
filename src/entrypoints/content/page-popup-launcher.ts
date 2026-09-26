import { browser } from "#imports";

const HOST_ID = "storylens-page-launcher";
const POSITION_KEY = "storylens-page-launcher-position";
const BUTTON_SIZE = 52;
const EDGE = 8;
const GAP = 8;
const POPUP_WIDTH = 390;
const POPUP_HEIGHT = 640;
const ACTION_SIZE = 36;
const ACTION_SHOW_DELAY = 200;
const ACTION_HIDE_DELAY = 300;

type Position = { x: number; y: number };
type Launcher = {
	host: HTMLElement;
	setLocale: (locale: string) => void;
	close: () => void;
	selectText: () => void;
	dispose: () => void;
};

let launcher: Launcher | undefined;

function labels(locale: string): {
	open: string;
	close: string;
	select: string;
} {
	return locale.toLowerCase().startsWith("ar")
		? {
				open: "افتح عدسة القصة",
				close: "إغلاق عدسة القصة",
				select: "حدد نصاً في الصفحة",
			}
		: {
				open: "Open Story Lens",
				close: "Close Story Lens",
				select: "Select text on page",
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

function createLauncher(locale: string): Launcher {
	let currentLocale = locale;
	let selecting = false;
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
		button{font:600 14px system-ui,sans-serif;cursor:pointer}
		#launcher{display:grid;place-items:center;width:100%;height:100%;padding:2px;border:3px solid #9d6843;border-radius:50%;background:#fff8ed;box-shadow:0 3px 14px #0006;touch-action:none;user-select:none;box-sizing:border-box;transition:transform 180ms ease}
		@media(prefers-reduced-motion:reduce){#launcher{transition:none}}
		#launcher:hover,#launcher:focus-visible{border-color:#754629;outline:2px solid #d8a960;outline-offset:2px}
		#logo{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none}
		#panel{position:fixed;box-sizing:border-box;border:1px solid #9d6843;border-radius:12px;background:#102033;box-shadow:0 8px 32px #0008;overflow:hidden}
		#panel[hidden]{display:none}
		iframe{display:block;border:0;background:#242424;transform-origin:top left}
		#action{position:absolute;left:50%;display:grid;place-items:center;width:${ACTION_SIZE}px;height:${ACTION_SIZE}px;margin-left:${-ACTION_SIZE / 2}px;padding:0;border:3px solid #9d6843;border-radius:50%;background:#fff8ed;color:#754629;box-shadow:0 3px 10px #0005;box-sizing:border-box}
		#action[hidden]{display:none}
		#action[data-side="below"]{top:calc(100% + ${GAP}px)}
		#action[data-side="above"]{bottom:calc(100% + ${GAP}px)}
		#action:hover,#action:focus-visible{border-color:#754629;outline:2px solid #d8a960;outline-offset:2px}
		#action svg{width:18px;height:18px;pointer-events:none}
	`;
	const button = document.createElement("button");
	button.id = "launcher";
	button.type = "button";
	button.setAttribute("aria-haspopup", "dialog");
	button.setAttribute("aria-expanded", "false");
	button.setAttribute("aria-label", labels(locale).open);
	const logo = document.createElement("img");
	logo.id = "logo";
	logo.alt = "";
	logo.draggable = false;
	logo.src = browser.runtime.getURL("/icons/128.png");
	button.append(logo);
	const action = document.createElement("button");
	action.id = "action";
	action.type = "button";
	action.hidden = true;
	action.setAttribute("aria-label", labels(locale).select);
	action.title = labels(locale).select;
	action.innerHTML =
		'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
	const panel = document.createElement("section");
	panel.id = "panel";
	panel.hidden = true;
	panel.setAttribute("role", "dialog");
	panel.setAttribute("aria-label", labels(locale).open);
	const hint = document.createElement("div");
	hint.hidden = true;
	hint.setAttribute("role", "status");
	hint.style.cssText =
		"position:fixed;top:12px;left:50%;transform:translateX(-50%);padding:10px 16px;border-radius:8px;background:#102033;color:white;font:14px system-ui;pointer-events:none;max-width:80vw;";
	const updateHint = () => {
		hint.textContent = currentLocale.startsWith("ar")
			? "انقر على كلمة أو اسحب لتحديد نص. اضغط Escape للإلغاء."
			: "Click a word or drag to select text. Press Escape to cancel.";
	};
	updateHint();
	shadow.append(style, button, action, panel, hint);
	(document.body ?? document.documentElement).append(host);

	const layoutPopup = () => {
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
			!action.hidden ||
			shadow.activeElement === button ||
			shadow.activeElement === action;
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
		if (action.hidden) return;
		action.hidden = true;
		updateTuck();
	};
	const showAction = () => {
		clearActionTimer();
		if (drag || tucked || !panel.hidden || selecting) return;
		const size = button.offsetWidth || BUTTON_SIZE;
		// Open toward the larger half of the viewport so the action stays visible.
		action.dataset.side =
			position.y + size / 2 < window.innerHeight / 2 ? "below" : "above";
		action.hidden = false;
		updateTuck();
	};
	const scheduleShowAction = () => {
		if (!action.hidden) {
			clearActionTimer();
			return;
		}
		clearActionTimer();
		actionTimer = setTimeout(showAction, ACTION_SHOW_DELAY);
	};
	const scheduleHideAction = () => {
		clearActionTimer();
		if (action.hidden) return;
		actionTimer = setTimeout(hideAction, ACTION_HIDE_DELAY);
	};
	const onButtonFocus = () => {
		updateTuck();
		if (button.matches(":focus-visible")) showAction();
	};
	const onControlBlur = (event: FocusEvent) => {
		updateTuck();
		const next = event.relatedTarget;
		if (next !== button && next !== action) scheduleHideAction();
	};
	const onActionClick = () => {
		hideAction();
		selectText();
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
	const close = () => {
		hideAction();
		selecting = false;
		hint.hidden = true;
		selectionStart = undefined;
		panel.hidden = true;
		button.setAttribute("aria-expanded", "false");
		panel.querySelector("iframe")?.remove();
		updateTuck();
	};
	const open = (search?: string) => {
		hideAction();
		selecting = false;
		hint.hidden = true;
		selectionStart = undefined;
		const frame = document.createElement("iframe");
		frame.title = labels(currentLocale).open;
		frame.src =
			browser.runtime.getURL("/popup.html") +
			(search ? `?search=${encodeURIComponent(search)}` : "");
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
			let text = window.getSelection()?.toString().trim() ?? "";
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
							break;
						}
					}
				}
			}
			if (!text) return;
			selecting = false;
			hint.hidden = true;
			open(text);
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
	action.addEventListener("pointerenter", clearActionTimer);
	action.addEventListener("pointerleave", scheduleHideAction);
	action.addEventListener("blur", onControlBlur);
	action.addEventListener("click", onActionClick);
	document.addEventListener("pointermove", onCursorMove);
	document.documentElement.addEventListener("pointerleave", onCursorLeave);
	document.addEventListener("pointerdown", onPointerOutside);
	document.addEventListener("pointerup", onSelectionEnd);
	document.addEventListener("keydown", onKeyDown);
	window.addEventListener("resize", onResize);
	setPosition(position);
	void browser.storage.local
		.get(POSITION_KEY)
		.then((stored) => {
			if (!interacted && host.isConnected) {
				const saved = storedPosition(stored[POSITION_KEY]);
				if (saved) setPosition(saved);
			}
		})
		.catch(() => {});
	return {
		host,
		setLocale: (nextLocale) => {
			currentLocale = nextLocale;
			updateHint();
			button.setAttribute("aria-label", labels(nextLocale).open);
			panel.setAttribute("aria-label", labels(nextLocale).open);
			action.setAttribute("aria-label", labels(nextLocale).select);
			action.title = labels(nextLocale).select;

			const frame = panel.querySelector("iframe");
			if (frame) frame.title = labels(nextLocale).open;
		},
		selectText,
		close,
		dispose: () => {
			close();
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

export function startPageTextSelection(): void {
	launcher?.selectText();
}
