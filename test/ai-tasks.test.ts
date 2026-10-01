/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import {
	type AiTaskReport,
	createAiTaskList,
	parseAiTaskReport,
} from "../src/lib/launcher-frame/ai-tasks";

const working = (
	id: string,
	source: AiTaskReport["source"] = "popup",
): AiTaskReport => ({
	id,
	state: "working",
	operation: "generate-image",
	subject: "Rand",
	source,
});
const finished = (
	id: string,
	state: "done" | "failed",
	source: AiTaskReport["source"] = "popup",
): AiTaskReport => ({
	id,
	state,
	operation: "generate-image",
	subject: "Rand",
	source,
});
const released = (
	id: string,
	source: AiTaskReport["source"] = "popup",
): AiTaskReport => ({ id, state: "released", source });

describe("AI task reports", () => {
	it("reads well-formed reports", () => {
		expect(
			parseAiTaskReport({
				id: "a",
				state: "working",
				operation: "suggest-keyword",
				subject: "  Rand  ",
				source: "panel",
			}),
		).toEqual({
			id: "a",
			state: "working",
			operation: "suggest-keyword",
			subject: "Rand",
			source: "panel",
		});
		expect(
			parseAiTaskReport({ id: "a", state: "released", source: "popup" }),
		).toEqual({ id: "a", state: "released", source: "popup" });
	});

	it("rejects malformed reports and caps the subject", () => {
		for (const data of [
			null,
			"working",
			{ state: "working", operation: "summarize", source: "popup" },
			{ id: "", state: "working", operation: "summarize", source: "popup" },
			{ id: "a", state: "running", operation: "summarize", source: "popup" },
			{ id: "a", state: "done", operation: "delete-all", source: "popup" },
			{ id: "a", state: "done", operation: "summarize", source: "site" },
			{ id: "a", state: "done", operation: "summarize" },
		])
			expect(parseAiTaskReport(data)).toBeUndefined();
		const report = parseAiTaskReport({
			id: "a",
			state: "done",
			operation: "summarize",
			subject: "x".repeat(500),
			source: "page",
		});
		expect(report && "subject" in report ? report.subject : "").toHaveLength(
			200,
		);
	});
});

describe("AI task list", () => {
	it("lists a running task and marks it done with its result held", () => {
		const list = createAiTaskList();
		list.apply(working("a"));
		expect(list.shown()).toMatchObject([{ id: "a", state: "working" }]);
		expect(list.unsaved()).toBe(true);

		list.apply(finished("a", "done"), 1000);
		expect(list.shown()).toMatchObject([
			{ id: "a", state: "done", finishedAt: 1000 },
		]);
		// The result waits in a form until the reader saves or closes it.
		expect(list.unsaved()).toBe(true);

		list.apply(released("a"));
		expect(list.shown()).toMatchObject([{ id: "a", state: "done" }]);
		expect(list.unsaved()).toBe(false);
	});

	it("holds nothing for a failed task", () => {
		const list = createAiTaskList();
		list.apply(working("a"));
		list.apply(finished("a", "failed"));
		expect(list.shown()).toMatchObject([{ id: "a", state: "failed" }]);
		expect(list.unsaved()).toBe(false);
	});

	it("removes a task released while it runs, as it was cancelled", () => {
		const list = createAiTaskList();
		list.apply(working("a"));
		list.apply(released("a"));
		expect(list.shown()).toEqual([]);
		expect(list.unsaved()).toBe(false);
		// A late outcome of the cancelled request does not bring it back.
		list.apply(finished("a", "done"));
		list.apply(working("a"));
		expect(list.shown()).toEqual([]);
	});

	it("ignores updates for tasks it never saw and repeated starts", () => {
		const list = createAiTaskList();
		list.apply(finished("ghost", "done"));
		list.apply(released("ghost"));
		expect(list.shown()).toEqual([]);

		list.apply(working("a"));
		list.apply(finished("a", "done"), 5);
		list.apply(working("a"));
		expect(list.shown()).toMatchObject([{ id: "a", state: "done" }]);
	});

	it("dismisses only finished tasks and keeps their results held", () => {
		const list = createAiTaskList();
		list.apply(working("a"));
		list.apply(working("b"));
		list.apply(finished("b", "done"));
		list.dismiss(() => true);
		expect(list.shown().map((task) => task.id)).toEqual(["a"]);
		expect(list.unsaved()).toBe(true);
		list.apply(finished("a", "done"));
		list.apply(released("a"));
		expect(list.unsaved()).toBe(true);
		list.apply(released("b"));
		expect(list.unsaved()).toBe(false);
	});

	it("drops every task of a frame that went away", () => {
		const list = createAiTaskList();
		list.apply(working("a", "popup"));
		list.apply(working("b", "popup"));
		list.apply(finished("b", "done", "popup"));
		list.apply(working("c", "panel"));
		list.drop((task) => task.source === "popup");
		expect(list.shown().map((task) => task.id)).toEqual(["c"]);
		list.drop((task) => task.source === "panel");
		expect(list.shown()).toEqual([]);
		expect(list.unsaved()).toBe(false);
	});

	it("notifies subscribers of changes only", () => {
		const list = createAiTaskList();
		let calls = 0;
		const unsubscribe = list.subscribe(() => {
			calls += 1;
		});
		list.apply(working("a"));
		list.dismiss(() => true);
		list.drop((task) => task.source === "panel");
		expect(calls).toBe(1);
		unsubscribe();
		list.apply(finished("a", "done"));
		expect(calls).toBe(1);
	});
});
