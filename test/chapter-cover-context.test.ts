import { expect, test } from "bun:test";
import {
	coverContextJson,
	waitForChapterCoverContext,
	waitForContextPoll,
} from "../src/lib/chapter-cover/context";
import { buildChapterCoverPrompt } from "../src/lib/chapter-cover/prompt";
import { coverChapter } from "./helpers/chapter-cover";
import { coverContext, readyCoverContext } from "./helpers/cover-context";

test("waits through missing context and a replacement before returning the ready snapshot", async () => {
	const ready = readyCoverContext();
	const records = [undefined, { ...ready, generating: true }, ready];
	const waiting: boolean[] = [];
	let polls = 0;
	const result = await waitForChapterCoverContext({
		read: async () => records.shift(),
		signal: new AbortController().signal,
		onWaiting: (value) => waiting.push(value),
		poll: async () => {
			polls++;
		},
	});
	expect(result).toEqual(coverContext());
	expect(waiting).toEqual([false, true]);
	expect(polls).toBe(2);
});

test("a late context read cannot proceed after cancellation", async () => {
	const controller = new AbortController();
	const pending = Promise.withResolvers<ReturnType<typeof readyCoverContext>>();
	const result = waitForChapterCoverContext({
		read: () => pending.promise,
		signal: controller.signal,
		onWaiting: () => {
			throw new Error("Must not wait");
		},
	});
	controller.abort(new Error("Stopped"));
	pending.resolve(readyCoverContext());
	await expect(result).rejects.toThrow("Stopped");
});

test("context polling can be cancelled immediately", async () => {
	const controller = new AbortController();
	const pending = waitForContextPoll(controller.signal);
	controller.abort(new Error("Stopped"));
	await expect(pending).rejects.toThrow("Stopped");
});

test("large contexts retain every scene overview and whole records within valid bounded JSON", () => {
	const context = coverContext();
	const scene = context.scenes[0];
	if (!scene) throw new Error("Missing fixture scene");
	const entity = scene.entities[0];
	if (!entity) throw new Error("Missing fixture entity");
	context.scenes = Array.from({ length: 30 }, (_, i) => ({
		...structuredClone(scene),
		id: `scene-${i}`,
		entities: Array.from({ length: 20 }, (_, j) => ({
			...structuredClone(entity),
			entityKey: `name:entity-${j}`,
			name: `Entity ${j}`,
			appearance: "a".repeat(1000),
		})),
	}));
	const original = JSON.stringify(context);
	const json = coverContextJson(context);
	const compact = JSON.parse(json) as typeof context & { abbreviated: boolean };
	expect(json.length).toBeLessThanOrEqual(60_000);
	expect(compact.abbreviated).toBe(true);
	expect(compact.scenes.map((scene) => scene.id)).toEqual(
		context.scenes.map((scene) => scene.id),
	);
	expect(compact.scenes.at(-1)?.entities.length).toBeGreaterThan(0);
	for (const scene of compact.scenes)
		for (const entity of scene.entities)
			expect(entity.appearance).toHaveLength(1000);
	expect(JSON.stringify(context)).toBe(original);
	const prompt = buildChapterCoverPrompt(
		coverChapter(),
		"Mira ".repeat(30_000),
		"Art ".repeat(5000),
		context,
	).prompt;
	expect(prompt.length).toBeLessThanOrEqual(180_000);
	expect(prompt).toContain("scene-29");
	const embedded = prompt
		.split("<CURRENT_CHAPTER_CONTEXT>\n")[1]
		?.split("\n</CURRENT_CHAPTER_CONTEXT>")[0];
	expect(() => JSON.parse(embedded ?? "")).not.toThrow();
	expect(prompt).toContain("<CHAPTER>\nMira");
});
