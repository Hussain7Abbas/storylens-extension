/**
 * Reading and retrying streamed desktop client jobs, free of extension APIs.
 * The client runs two jobs at a time and refuses more with `BUSY`; requests
 * from several popup tabs wait here for a free slot instead of failing.
 */

/** The desktop client refused a job because all its slots are taken. */
export class DesktopBusyError extends Error {}

/** Resolves after `ms`, or rejects as soon as `signal` aborts. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new Error("The request was cancelled."));
			return;
		}
		const done = () => {
			signal.removeEventListener("abort", cancel);
			resolve();
		};
		const timer = setTimeout(done, ms);
		const cancel = () => {
			clearTimeout(timer);
			reject(new Error("The request was cancelled."));
		};
		signal.addEventListener("abort", cancel, { once: true });
	});
}

/**
 * Runs `attempt` until it does not end in {@link DesktopBusyError}, waiting
 * `retryMs` between tries, until `signal` aborts or `waitMs` has passed.
 */
export async function retryWhileBusy<T>(
	attempt: () => Promise<T>,
	signal: AbortSignal,
	{ retryMs = 2_000, waitMs = 15 * 60_000 } = {},
): Promise<T> {
	const giveUp = Date.now() + waitMs;
	while (true) {
		try {
			return await attempt();
		} catch (error) {
			if (
				!(error instanceof DesktopBusyError) ||
				signal.aborted ||
				Date.now() >= giveUp
			)
				throw error;
			await wait(retryMs, signal);
		}
	}
}

export type ResultFrame = {
	type?: string;
	output?: string;
	mimeType?: string;
	data?: string;
	error?: { code?: string; message?: string };
};

/** Reads an NDJSON job stream until its single result frame, enforcing a size limit. */
export async function readResultFrame(
	response: Response,
	maxBytes: number,
	options: {
		onFrame?: (frame: ResultFrame) => Promise<void>;
		error?: (frame: ResultFrame) => Error;
	} = {},
): Promise<ResultFrame> {
	if (!response.body) throw new Error("Desktop client sent no response body.");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "",
		received = 0,
		result: ResultFrame | undefined;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			received += next.value.byteLength;
			if (received > maxBytes)
				throw new Error("Desktop client response exceeded the size limit.");
			buffer += decoder.decode(next.value, { stream: true });
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				if (line) {
					let frame: ResultFrame;
					try {
						frame = JSON.parse(line) as ResultFrame;
					} catch {
						throw new Error("Desktop client returned malformed data.");
					}
					await options.onFrame?.(frame);
					if (result)
						throw new Error("Desktop client returned multiple results.");
					if (frame.type === "result") result = frame;
					else if (frame.type === "error")
						throw options.error
							? options.error(frame)
							: frame.error?.code === "BUSY"
								? new DesktopBusyError(
										frame.error.message ?? "Desktop client is busy.",
									)
								: new Error(frame.error?.message ?? "Desktop client failed.");
					else if (frame.type !== "started" && frame.type !== "heartbeat")
						throw new Error("Desktop client returned an unknown event.");
				}
				newline = buffer.indexOf("\n");
			}
		}
		if (!result || buffer.trim())
			throw new Error(
				"Desktop client connection ended before a result arrived.",
			);
		return result;
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
