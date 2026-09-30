import { useEffect, useLayoutEffect, useRef } from "react";
import {
	createPopupWorkReporter,
	POPUP_ANSWER_MESSAGE,
	POPUP_READY_MESSAGE,
	POPUP_SHOWN_MESSAGE,
	POPUP_STATE_MESSAGE,
	parsePopupRequest,
} from "./messages";

const reporter = createPopupWorkReporter((state) =>
	// The parent is the novel site, whose origin is unknown; the message carries only flags.
	window.parent.postMessage({ type: POPUP_STATE_MESSAGE, ...state }, "*"),
);

/**
 * Answers the launcher's requests from the popup's state at that moment, so a
 * change the launcher has not heard of yet is never lost. A popup without
 * unsaved work loads the requested form itself. Call once, before rendering.
 */
export function connectLauncherFrame(
	load: (url: string) => void = (url) => window.location.replace(url),
): () => void {
	if (window.parent === window) return () => {};
	const receive = (message: MessageEvent) => {
		// The novel site is the parent too and can send this; a request only reloads a popup that holds nothing.
		if (message.source !== window.parent) return;
		const request = parsePopupRequest(message.data);
		if (!request) return;
		const kept = reporter.state().dirty;
		window.parent.postMessage(
			{ type: POPUP_ANSWER_MESSAGE, id: request.id, kept },
			"*",
		);
		if (kept || !request.reload) return;
		const query = new URLSearchParams(request.query).toString();
		load(window.location.pathname + (query ? `?${query}` : ""));
	};
	window.addEventListener("message", receive);
	window.parent.postMessage({ type: POPUP_READY_MESSAGE }, "*");
	return () => window.removeEventListener("message", receive);
}

/**
 * Reports a form's unsaved changes or a running AI request to the launcher,
 * which keeps a popup holding work and shows AI progress on its button. Does
 * nothing in the toolbar popup and the options page.
 */
export function useLauncherWork({
	dirty = false,
	working = false,
	failed = false,
}: {
	dirty?: boolean;
	working?: boolean;
	failed?: boolean;
}): void {
	const holder = useRef<symbol | null>(null);
	// Layout effects run inside the commit, so a request that follows an edit sees it.
	useLayoutEffect(() => {
		if (window.parent === window) return;
		holder.current ??= Symbol("launcher-work");
		reporter.set(holder.current, { dirty, working, failed });
	}, [dirty, working, failed]);
	useLayoutEffect(
		() => () => {
			if (!holder.current) return;
			reporter.remove(holder.current);
			holder.current = null;
		},
		[],
	);
}

/** Runs `callback` each time the launcher shows its kept popup again. */
export function useLauncherShown(callback: () => void): void {
	const latest = useRef(callback);
	latest.current = callback;
	useEffect(() => {
		if (window.parent === window) return;
		const receive = (message: MessageEvent) => {
			const data: unknown = message.data;
			if (
				message.source !== window.parent ||
				!data ||
				typeof data !== "object" ||
				!("type" in data) ||
				data.type !== POPUP_SHOWN_MESSAGE
			)
				return;
			latest.current();
		};
		window.addEventListener("message", receive);
		return () => window.removeEventListener("message", receive);
	}, []);
}
