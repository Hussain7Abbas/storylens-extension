import {
	decrementActiveSync,
	incrementActiveSync,
} from "@/store/sync-status";

export async function withBackgroundSync(
	task: () => Promise<void>,
): Promise<void> {
	incrementActiveSync();
	try {
		await task();
	} finally {
		decrementActiveSync();
	}
}
