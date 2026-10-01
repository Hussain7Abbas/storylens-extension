/**
 * Messages between the in-page launcher and the popup it keeps in an iframe.
 * The launcher hides that iframe instead of removing it, so the popup reports
 * what it holds and the launcher tells it when it is shown again.
 *
 * State messages arrive late, so they only drive the launcher's status dot.
 * Whether a popup may be replaced is always the popup's own answer to a
 * request: it alone knows its unsaved work at that moment.
 */

/** Popup → launcher: the flags of {@link PopupState}. */
export const POPUP_STATE_MESSAGE = "storylens-popup-state";
/** Launcher → popup: the kept popup is visible again. */
export const POPUP_SHOWN_MESSAGE = "storylens-popup-shown";
/** Popup → launcher: a popup document loaded and answers requests. */
export const POPUP_READY_MESSAGE = "storylens-popup-ready";
/** Launcher → popup: a {@link PopupRequest}. */
export const POPUP_REQUEST_MESSAGE = "storylens-popup-request";
/** Popup → launcher: a {@link PopupAnswer}. */
export const POPUP_ANSWER_MESSAGE = "storylens-popup-answer";

/**
 * Asks the popup to give way. With `reload` it loads `query` itself (a form
 * the reader requested); without, it only answers, and the launcher removes a
 * popup that is out of sight. A popup holding unsaved work refuses either.
 */
export type PopupRequest = { id: string; query: string; reload: boolean };
/** `kept`: the popup holds unsaved work and stayed as it was. */
export type PopupAnswer = { id: string; kept: boolean };

/** What one form or AI request in the popup currently holds. */
export type PopupWork = {
	/** Unsaved changes: edited fields or a picked or generated image. */
	dirty?: boolean;
	/** An AI request is running. */
	working?: boolean;
	/** The last AI request of this holder failed. */
	failed?: boolean;
};

export type PopupState = {
	/** Something would be lost by reloading the popup; a running request counts. */
	dirty: boolean;
	working: boolean;
	/** Whether the request that finished last failed. */
	failed: boolean;
};

/** Reads a popup state message; anything else is `undefined`. */
export function parsePopupState(data: unknown): PopupState | undefined {
	if (!data || typeof data !== "object" || !("type" in data)) return undefined;
	if (data.type !== POPUP_STATE_MESSAGE) return undefined;
	return {
		dirty: "dirty" in data && data.dirty === true,
		working: "working" in data && data.working === true,
		failed: "failed" in data && data.failed === true,
	};
}

function typed(data: unknown, type: string): data is object {
	return (
		!!data && typeof data === "object" && "type" in data && data.type === type
	);
}

export function isPopupReady(data: unknown): boolean {
	return typed(data, POPUP_READY_MESSAGE);
}

/** The key a ready popup announced for its AI tasks, if any. */
export function popupReadyKey(data: unknown): string | undefined {
	if (!typed(data, POPUP_READY_MESSAGE) || !("key" in data)) return undefined;
	return typeof data.key === "string" && data.key && data.key.length <= 64
		? data.key
		: undefined;
}

export function parsePopupRequest(data: unknown): PopupRequest | undefined {
	if (!typed(data, POPUP_REQUEST_MESSAGE)) return undefined;
	if (!("id" in data) || typeof data.id !== "string") return undefined;
	return {
		id: data.id,
		query: "query" in data && typeof data.query === "string" ? data.query : "",
		reload: "reload" in data && data.reload === true,
	};
}

export function parsePopupAnswer(data: unknown): PopupAnswer | undefined {
	if (!typed(data, POPUP_ANSWER_MESSAGE)) return undefined;
	if (!("id" in data) || typeof data.id !== "string") return undefined;
	// Anything but an explicit "nothing held" keeps the popup.
	return { id: data.id, kept: !("kept" in data) || data.kept !== false };
}

/** Combines the work of every mounted form and AI request into one popup state. */
export function createPopupWorkTracker(): {
	set: (holder: symbol, work: PopupWork) => void;
	remove: (holder: symbol) => void;
	state: () => PopupState;
} {
	const holders = new Map<symbol, PopupWork>();
	let failed = false;
	return {
		set: (holder, work) => {
			// The outcome belongs to the request that just ended, not to older errors still on screen.
			if (holders.get(holder)?.working && !work.working) failed = !!work.failed;
			holders.set(holder, work);
		},
		remove: (holder) => {
			if (holders.get(holder)?.working) failed = false;
			holders.delete(holder);
		},
		state: () => {
			const all = [...holders.values()];
			const working = all.some((work) => work.working);
			return {
				dirty: working || all.some((work) => work.dirty),
				working,
				failed,
			};
		},
	};
}

/**
 * Tracks the popup's work and hands each changed state to `post`. Updates of
 * one commit are combined, so a request that ends as its result becomes unsaved
 * work is never reported as a moment with nothing to keep.
 */
export function createPopupWorkReporter(post: (state: PopupState) => void): {
	set: (holder: symbol, work: PopupWork) => void;
	remove: (holder: symbol) => void;
	/** The state right now, ahead of any message still on its way. */
	state: () => PopupState;
} {
	const tracker = createPopupWorkTracker();
	// The launcher assumes a freshly loaded popup holds nothing.
	let sent = JSON.stringify(tracker.state());
	let scheduled = false;
	const publish = () => {
		if (scheduled) return;
		scheduled = true;
		queueMicrotask(() => {
			scheduled = false;
			const state = tracker.state();
			const key = JSON.stringify(state);
			if (key === sent) return;
			sent = key;
			post(state);
		});
	};
	return {
		set: (holder, work) => {
			tracker.set(holder, work);
			publish();
		},
		remove: (holder) => {
			tracker.remove(holder);
			publish();
		},
		state: tracker.state,
	};
}
