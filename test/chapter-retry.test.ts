import { expect, spyOn, test } from "bun:test";
import { retryChapterTask } from "../src/lib/ai-source/chapter-retry";

test("chapter retries continue beyond a fixed attempt limit with capped exponential delays", async () => {
	const nativeTimeout = globalThis.setTimeout;
	const delays: number[] = [];
	const timer = spyOn(globalThis, "setTimeout").mockImplementation(((
		...args: Parameters<typeof setTimeout>
	) => {
		const [handler, timeout, ...rest] = args;
		delays.push(timeout ?? 0);
		return nativeTimeout(handler, 0, ...rest);
	}) as typeof setTimeout);
	let attempts = 0;
	let retries = 0;
	const errors: unknown[] = [];
	try {
		const result = await retryChapterTask(
			async () => {
				if (++attempts < 9) throw new Error("Temporary failure");
				return "saved";
			},
			new AbortController().signal,
			(error) => {
				errors.push(error);
				retries++;
			},
		);
		expect(result).toBe("saved");
		expect(attempts).toBe(9);
		expect(retries).toBe(8);
		expect(
			errors.every(
				(error) =>
					error instanceof Error && error.message === "Temporary failure",
			),
		).toBe(true);
		expect(delays).toEqual([
			2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000,
		]);
	} finally {
		timer.mockRestore();
	}
});

test("cancellation before a chapter retry delay starts does not leave a timer running", async () => {
	const controller = new AbortController();
	let attempts = 0;
	const reason = new Error("Stopped");
	const result = retryChapterTask(
		async () => {
			attempts++;
			throw new Error("Offline");
		},
		controller.signal,
		() => controller.abort(reason),
	);
	await expect(result).rejects.toBe(reason);
	expect(attempts).toBe(1);
});
