/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import {
	DesktopBusyError,
	readResultFrame,
	retryWhileBusy,
} from "../src/lib/desktop-client/job-stream";

/** The client's NDJSON stream: `started`, then `frames`. */
function stream(frames: Record<string, unknown>[]): Response {
	return new Response(
		[{ type: "started", requestId: "r" }, ...frames]
			.map((frame) => `${JSON.stringify(frame)}\n`)
			.join(""),
	);
}

const busy = () => new DesktopBusyError("Desktop client is busy.");
const fast = { retryMs: 0 };

describe("desktop job stream", () => {
	it("reads a busy refusal as its own error", async () => {
		const refused = readResultFrame(
			stream([
				{
					type: "error",
					error: { code: "BUSY", message: "Desktop client is busy." },
				},
			]),
			1000,
		);
		await expect(refused).rejects.toBeInstanceOf(DesktopBusyError);
		const failed = readResultFrame(
			stream([
				{ type: "error", error: { code: "MODEL", message: "No model." } },
			]),
			1000,
		);
		await expect(failed).rejects.not.toBeInstanceOf(DesktopBusyError);
		await expect(
			readResultFrame(stream([{ type: "result", output: "ok" }]), 1000),
		).resolves.toMatchObject({ output: "ok" });
	});
});

describe("desktop jobs while the client is busy", () => {
	it("waits for a free slot and then runs", async () => {
		let calls = 0;
		const result = await retryWhileBusy(
			async () => {
				calls += 1;
				if (calls < 3) throw busy();
				return "A shepherd.";
			},
			new AbortController().signal,
			fast,
		);
		expect(result).toBe("A shepherd.");
		expect(calls).toBe(3);
	});

	it("does not retry other failures", async () => {
		let calls = 0;
		const running = retryWhileBusy(
			async () => {
				calls += 1;
				throw new Error("No model.");
			},
			new AbortController().signal,
			fast,
		);
		await expect(running).rejects.toThrow("No model.");
		expect(calls).toBe(1);
	});

	it("stops waiting when the request is cancelled", async () => {
		const controller = new AbortController();
		let calls = 0;
		const running = retryWhileBusy(
			async () => {
				calls += 1;
				throw busy();
			},
			controller.signal,
			{ retryMs: 60_000 },
		);
		await new Promise((resolve) => setTimeout(resolve, 5));
		controller.abort();
		await expect(running).rejects.toThrow("The request was cancelled.");
		expect(calls).toBe(1);
	});

	it("gives up after the waiting time", async () => {
		let calls = 0;
		const running = retryWhileBusy(
			async () => {
				calls += 1;
				throw busy();
			},
			new AbortController().signal,
			{ retryMs: 0, waitMs: 0 },
		);
		await expect(running).rejects.toBeInstanceOf(DesktopBusyError);
		expect(calls).toBe(1);
	});
});
