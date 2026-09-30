/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import {
	createPopupWorkReporter,
	createPopupWorkTracker,
	isPopupReady,
	POPUP_ANSWER_MESSAGE,
	POPUP_READY_MESSAGE,
	POPUP_REQUEST_MESSAGE,
	POPUP_STATE_MESSAGE,
	type PopupState,
	parsePopupAnswer,
	parsePopupRequest,
	parsePopupState,
} from "../src/lib/launcher-frame/messages";

/** Lets the state queued by the last updates go out. */
const flush = () => Promise.resolve();

describe("popup work tracker", () => {
	it("is clean without holders", () => {
		expect(createPopupWorkTracker().state()).toEqual({
			dirty: false,
			working: false,
			failed: false,
		});
	});

	it("is dirty while any holder has unsaved changes", () => {
		const tracker = createPopupWorkTracker();
		const form = Symbol("form");
		tracker.set(form, { dirty: true });
		tracker.set(Symbol("image"), {});
		expect(tracker.state().dirty).toBe(true);

		tracker.set(form, { dirty: false });
		expect(tracker.state().dirty).toBe(false);

		tracker.set(form, { dirty: true });
		tracker.remove(form);
		expect(tracker.state().dirty).toBe(false);
	});

	it("counts a running request as unsaved work", () => {
		const tracker = createPopupWorkTracker();
		tracker.set(Symbol("image"), { working: true });
		expect(tracker.state()).toEqual({
			dirty: true,
			working: true,
			failed: false,
		});
	});

	it("reports the outcome of the request that just ended", () => {
		const tracker = createPopupWorkTracker();
		const suggestion = Symbol("suggestion");
		const image = Symbol("image");

		tracker.set(suggestion, { working: true });
		tracker.set(suggestion, { working: false, failed: true });
		expect(tracker.state().failed).toBe(true);

		// The old error is still on screen, but the image request succeeded.
		tracker.set(image, { working: true });
		tracker.set(image, { working: false });
		expect(tracker.state()).toEqual({
			dirty: false,
			working: false,
			failed: false,
		});
	});

	it("does not treat an error shown without a request as an outcome", () => {
		const tracker = createPopupWorkTracker();
		tracker.set(Symbol("image"), { failed: true });
		expect(tracker.state().failed).toBe(false);
	});
});

describe("popup state messages", () => {
	it("reads the flags and defaults missing or mistyped ones to false", () => {
		expect(
			parsePopupState({ type: POPUP_STATE_MESSAGE, dirty: true, working: 1 }),
		).toEqual({ dirty: true, working: false, failed: false });
	});

	it("rejects everything else", () => {
		for (const data of [
			null,
			"storylens-popup-state",
			{ dirty: true },
			{ type: "storylens-selection-close", dirty: true },
		])
			expect(parsePopupState(data)).toBeUndefined();
	});
});

describe("popup requests and answers", () => {
	it("reads a request and defaults a missing query and reload", () => {
		expect(
			parsePopupRequest({
				type: POPUP_REQUEST_MESSAGE,
				id: "3",
				query: "create=keyword",
				reload: true,
			}),
		).toEqual({ id: "3", query: "create=keyword", reload: true });
		expect(parsePopupRequest({ type: POPUP_REQUEST_MESSAGE, id: "4" })).toEqual(
			{ id: "4", query: "", reload: false },
		);
	});

	it("rejects a request without a string id or of another type", () => {
		for (const data of [
			null,
			{ type: POPUP_REQUEST_MESSAGE },
			{ type: POPUP_REQUEST_MESSAGE, id: 3 },
			{ type: POPUP_ANSWER_MESSAGE, id: "3" },
		])
			expect(parsePopupRequest(data)).toBeUndefined();
	});

	it("reads an answer as kept unless it clearly says nothing is held", () => {
		const answer = { type: POPUP_ANSWER_MESSAGE, id: "3" };
		expect(parsePopupAnswer({ ...answer, kept: false })).toEqual({
			id: "3",
			kept: false,
		});
		for (const kept of [true, undefined, 0, "false"])
			expect(parsePopupAnswer({ ...answer, kept })?.kept).toBe(true);
		expect(parsePopupAnswer({ type: POPUP_ANSWER_MESSAGE })).toBeUndefined();
		expect(parsePopupAnswer({ ...answer, type: "other" })).toBeUndefined();
	});

	it("recognizes the ready message only", () => {
		expect(isPopupReady({ type: POPUP_READY_MESSAGE })).toBe(true);
		expect(isPopupReady({ type: POPUP_STATE_MESSAGE })).toBe(false);
		expect(isPopupReady(POPUP_READY_MESSAGE)).toBe(false);
	});
});

describe("popup work reporter", () => {
	function reporter() {
		const posted: PopupState[] = [];
		return {
			posted,
			...createPopupWorkReporter((state) => posted.push(state)),
		};
	}

	it("posts each change once and stays silent while nothing is held", async () => {
		const { posted, set, remove } = reporter();
		const form = Symbol("form");

		// A form that holds nothing matches what the launcher assumes.
		set(form, { dirty: false });
		await flush();
		expect(posted).toEqual([]);

		set(form, { dirty: true });
		await flush();
		set(form, { dirty: true });
		await flush();
		expect(posted).toEqual([{ dirty: true, working: false, failed: false }]);

		remove(form);
		await flush();
		expect(posted).toEqual([
			{ dirty: true, working: false, failed: false },
			{ dirty: false, working: false, failed: false },
		]);
	});

	it("combines the updates of one commit", async () => {
		const { posted, set, remove } = reporter();
		const form = Symbol("form");
		const image = Symbol("image");
		set(form, { dirty: false });
		set(image, { working: true });
		await flush();

		// The image arrives and becomes the form's unsaved file together.
		set(image, { working: false });
		set(form, { dirty: true });
		await flush();
		expect(posted).toEqual([
			{ dirty: true, working: true, failed: false },
			{ dirty: true, working: false, failed: false },
		]);

		// A holder that re-registers within a commit leaves no gap.
		remove(form);
		set(form, { dirty: true });
		await flush();
		expect(posted).toHaveLength(2);
	});

	it("knows its state before the message about it is sent", async () => {
		const { posted, set, state } = reporter();
		set(Symbol("form"), { dirty: true });

		expect(posted).toEqual([]);
		expect(state().dirty).toBe(true);
		await flush();
		expect(posted).toHaveLength(1);
	});

	it("reports a failed request with the state that ends it", async () => {
		const { posted, set } = reporter();
		const image = Symbol("image");
		set(image, { working: true });
		await flush();
		set(image, { working: false, failed: true });
		await flush();

		expect(posted.at(-1)).toEqual({
			dirty: false,
			working: false,
			failed: true,
		});
	});
});
