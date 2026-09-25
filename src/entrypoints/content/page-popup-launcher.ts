import { browser } from "#imports";

const HOST_ID = "storylens-page-launcher";

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

function createLauncher(locale: string): Launcher {
	let currentLocale = locale;
	const host = document.createElement("div");
	host.id = HOST_ID;
	host.setAttribute("data-storylens-skip", "");
	host.style.cssText =
		"all:initial;position:fixed;top:16px;right:16px;z-index:2147483647;";
	const shadow = host.attachShadow({ mode: "open" });
	const style = document.createElement("style");
	style.textContent =
		":host{all:initial}button{font:600 14px system-ui,sans-serif;cursor:pointer}#launcher{display:block;width:48px;height:48px;border:2px solid #e4fffa;border-radius:50%;background:#163d49;color:#fff;box-shadow:0 3px 14px #0006}#launcher:hover,#launcher:focus-visible{background:#236175;outline:2px solid #74c9be;outline-offset:2px}#panel{position:absolute;top:56px;right:0;width:min(390px,calc(100vw - 24px));height:min(640px,calc(100vh - 80px));border:1px solid #6aa8a2;border-radius:12px;background:#102033;box-shadow:0 8px 32px #0008;overflow:hidden}#panel[hidden]{display:none}#bar{height:36px;display:flex;align-items:center;justify-content:flex-end;padding:0 8px;background:#163d49}#close{border:0;background:transparent;color:#fff;font-size:22px;line-height:1}iframe{display:block;width:100%;height:calc(100% - 36px);border:0;background:#242424}";
	const button = document.createElement("button");
	button.id = "launcher";
	button.type = "button";
	button.textContent = "SL";
	button.setAttribute("aria-haspopup", "dialog");
	button.setAttribute("aria-expanded", "false");
	button.setAttribute("aria-label", labels(locale).open);
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
	};
	const onButtonClick = () => (panel.hidden ? open() : close());
	const onPointerDown = (event: PointerEvent) => {
		if (!host.contains(event.target as Node)) close();
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Escape" && !panel.hidden) {
			close();
			button.focus();
		}
	};
	button.addEventListener("click", onButtonClick);
	closeButton.addEventListener("click", close);
	document.addEventListener("pointerdown", onPointerDown);
	document.addEventListener("keydown", onKeyDown);
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
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
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
