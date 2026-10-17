/** Retry page-owned chapter work until it succeeds or the reader cancels it. */
export async function retryChapterTask<T>(
	task: () => Promise<T>,
	signal: AbortSignal,
	onRetry: (error: unknown) => void,
): Promise<T> {
	let delay = 2000;
	while (true) {
		signal.throwIfAborted();
		try {
			return await task();
		} catch (error) {
			signal.throwIfAborted();
			onRetry(error);
			await new Promise<void>((resolve, reject) => {
				const cancel = () => {
					clearTimeout(timer);
					reject(signal.reason);
				};
				const timer = setTimeout(() => {
					signal.removeEventListener("abort", cancel);
					resolve();
				}, delay);
				signal.addEventListener("abort", cancel, { once: true });
				if (signal.aborted) cancel();
			});
			delay = Math.min(delay * 2, 60_000);
		}
	}
}
