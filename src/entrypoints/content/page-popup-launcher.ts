import { browser } from "#imports";

const HOST_ID = "storylens-page-launcher";
const POSITION_KEY = "storylens-page-launcher-position";
const BUTTON_SIZE = 52;
const EDGE = 8;
const GAP = 8;
const POPUP_WIDTH = 390;
const POPUP_HEIGHT = 640;

type Position = { x: number; y: number };
type Launcher = {
	host: HTMLElement;
	setLocale: (locale: string) => void;
	close: () => void;
	dispose: () => void;
};

let launcher: Launcher | undefined;

function labels(locale: string): { open: string; close: string } {
	return locale.toLowerCase().startsWith("ar")
		? { open: "افتح عدسة القصة", close: "إغلاق عدسة القصة" }
		: { open: "Open Story Lens", close: "Close Story Lens" };
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
	let position: Position = { x: window.innerWidth - BUTTON_SIZE - 16, y: 16 };
	let interacted = false;
	let suppressClick = false;
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
		#launcher{display:grid;place-items:center;width:100%;height:100%;padding:2px;border:3px solid #9d6843;border-radius:50%;background:#fff8ed;box-shadow:0 3px 14px #0006;touch-action:none;user-select:none;box-sizing:border-box}
		#launcher:hover,#launcher:focus-visible{border-color:#754629;outline:2px solid #d8a960;outline-offset:2px}
		#logo{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none}
		#panel{position:fixed;box-sizing:border-box;border:1px solid #9d6843;border-radius:12px;background:#102033;box-shadow:0 8px 32px #0008;overflow:hidden}
		#panel[hidden]{display:none}
		#bar{height:36px;display:flex;align-items:center;justify-content:flex-end;padding:0 8px;background:#163d49}
		#close{border:0;background:transparent;color:#fff;font-size:22px;line-height:1}
		iframe{display:block;border:0;background:#242424;transform-origin:top left}
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
	const panel = document.createElement("section");
	panel.id = "panel";
	panel.hidden = true;
	panel.setAttribute("role", "dialog");
	panel.setAttribute("aria-label", labels(locale).open);
	const bar = document.createElement("div");
	bar.id = "bar";
	const closeButton = document.createElement("button");
	closeButton.id = "close";
	closeButton.type = "button";
	closeButton.textContent = "×";
	closeButton.setAttribute("aria-label", labels(locale).close);
	bar.append(closeButton);
	panel.append(bar);
	shadow.append(style, button, panel);
	(document.body ?? document.documentElement).append(host);

	const layoutPopup = () => {
		if (panel.hidden) return;
		const rect = button.getBoundingClientRect();
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
			frame.style.height = `${Math.max(1, (height - 36) / scale)}px`;
			frame.style.transform = `scale(${scale})`;
		}
	};
	const setPosition = (next: Position) => {
		position = clampPosition(
			next,
			button.getBoundingClientRect().width || BUTTON_SIZE,
		);
		host.style.left = `${position.x}px`;
		host.style.top = `${position.y}px`;
		layoutPopup();
	};
	const close = () => {
		panel.hidden = true;
		button.setAttribute("aria-expanded", "false");
		panel.querySelector("iframe")?.remove();
	};
	const open = () => {
		const frame = document.createElement("iframe");
		frame.title = labels(currentLocale).open;
		frame.src = browser.runtime.getURL("/popup.html");
		panel.append(frame);
		panel.hidden = false;
		button.setAttribute("aria-expanded", "true");
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
	};
	const onPointerOutside = (event: PointerEvent) => {
		if (!host.contains(event.target as Node)) close();
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Escape" && !panel.hidden) {
			close();
			button.focus();
		}
	};
	const onResize = () => setPosition(position);
	button.addEventListener("click", onButtonClick);
	button.addEventListener("pointerdown", onPointerDown);
	button.addEventListener("pointermove", onPointerMove);
	button.addEventListener("pointerup", onPointerEnd);
	button.addEventListener("pointercancel", onPointerEnd);
	closeButton.addEventListener("click", close);
	document.addEventListener("pointerdown", onPointerOutside);
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
			button.setAttribute("aria-label", labels(nextLocale).open);
			panel.setAttribute("aria-label", labels(nextLocale).open);
			closeButton.setAttribute("aria-label", labels(nextLocale).close);
			const frame = panel.querySelector("iframe");
			if (frame) frame.title = labels(nextLocale).open;
		},
		close,
		dispose: () => {
			close();
			document.removeEventListener("pointerdown", onPointerOutside);
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
