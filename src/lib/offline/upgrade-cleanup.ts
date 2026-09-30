import Dexie from "dexie";
import { browser } from "#imports";

/** 3.2.x storage: its IndexedDB database and its `storage.local` pending-operation pool. */
export const OLD_DB_NAME = "storylens-offline";
export const OLD_POOL_KEY = "storylens-sync-state";

let cleaned = false;

/**
 * Deletes the 3.2.x offline storage without reading it (decisions D13, D14:
 * readers start fresh and download their novels again). Runs on
 * `runtime.onInstalled` for updates and at every worker start until it has
 * succeeded once in this worker; errors are logged and retried next start.
 *
 * Remove this module in the release after the offline-first release.
 */
export async function deleteOldStorage(): Promise<boolean> {
	if (cleaned) return true;
	try {
		await browser.storage.local.remove(OLD_POOL_KEY);
		await Dexie.delete(OLD_DB_NAME);
		cleaned = true;
		return true;
	} catch (error) {
		console.warn(
			"[StoryLens] Could not delete 3.2 offline storage; retrying next start",
			error,
		);
		return false;
	}
}

/** Tests: forget that this worker already cleaned up. */
export function resetOldStorageCleanupForTests(): void {
	cleaned = false;
}
