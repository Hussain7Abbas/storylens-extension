export const SYNC_LOCK_NAME = "storylens-sync";

type LockManagerLike = {
	request<T>(
		name: string,
		options: { ifAvailable: true },
		callback: (lock: unknown) => Promise<T>,
	): Promise<T>;
};

let override: LockManagerLike | undefined;
let held = false;

/** Tests: a fake `navigator.locks`. */
export function setLockManagerForTests(
	manager: LockManagerLike | undefined,
): void {
	override = manager;
}

/**
 * Runs `task` holding the sync lock, or returns `undefined` at once when it is
 * held. Uses Web Locks (Chrome 69+, Firefox 96+); without them, only the
 * background runs the runner, so an in-memory flag serializes it.
 */
export async function withSyncLock<T>(
	task: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
	const manager =
		override ??
		(typeof navigator !== "undefined"
			? (navigator as Navigator & { locks?: LockManagerLike }).locks
			: undefined);
	if (manager) {
		return manager.request(
			SYNC_LOCK_NAME,
			{ ifAvailable: true },
			async (lock) => {
				if (!lock) return { ran: false as const };
				return { ran: true as const, value: await task() };
			},
		);
	}
	if (held) return { ran: false };
	held = true;
	try {
		return { ran: true, value: await task() };
	} finally {
		held = false;
	}
}
