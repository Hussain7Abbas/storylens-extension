import { browser } from "#imports";
import {
	DEFAULT_SYNC_STATE,
	SYNC_STORAGE_KEY,
	type SyncOperation,
	type SyncState,
} from "@/lib/offline/types";

async function readSyncState(): Promise<SyncState> {
	const result = await browser.storage.local.get(SYNC_STORAGE_KEY);
	const stored = result[SYNC_STORAGE_KEY];

	if (!stored || typeof stored !== "object") {
		return { ...DEFAULT_SYNC_STATE };
	}

	const state = stored as Partial<SyncState>;
	return {
		pendingOps: Array.isArray(state.pendingOps) ? state.pendingOps : [],
		lastSyncAt: typeof state.lastSyncAt === "number" ? state.lastSyncAt : 0,
		downloadedNovelIds: Array.isArray(state.downloadedNovelIds)
			? state.downloadedNovelIds
			: [],
	};
}

async function writeSyncState(state: SyncState): Promise<void> {
	await browser.storage.local.set({ [SYNC_STORAGE_KEY]: state });
}

export async function getSyncState(): Promise<SyncState> {
	return readSyncState();
}

export async function getPendingOps(): Promise<SyncOperation[]> {
	const state = await readSyncState();
	return state.pendingOps.filter((op) => op.status !== "syncing");
}

export async function getPendingOpsCount(): Promise<number> {
	const ops = await getPendingOps();
	return ops.filter((op) => op.status === "pending" || op.status === "failed")
		.length;
}

export async function addPendingOp(operation: SyncOperation): Promise<void> {
	const state = await readSyncState();
	state.pendingOps.push(operation);
	await writeSyncState(state);
}

export async function updatePendingOp(
	operationId: string,
	updates: Partial<SyncOperation>,
): Promise<void> {
	const state = await readSyncState();
	state.pendingOps = state.pendingOps.map((op) =>
		op.id === operationId ? { ...op, ...updates } : op,
	);
	await writeSyncState(state);
}

export async function removePendingOp(operationId: string): Promise<void> {
	const state = await readSyncState();
	state.pendingOps = state.pendingOps.filter((op) => op.id !== operationId);
	await writeSyncState(state);
}

export async function replacePendingEntityId(
	tempEntityId: string,
	serverEntityId: string,
): Promise<void> {
	const state = await readSyncState();
	state.pendingOps = state.pendingOps.map((op) =>
		op.entityId === tempEntityId ? { ...op, entityId: serverEntityId } : op,
	);
	await writeSyncState(state);
}

export async function getDownloadedNovelIds(): Promise<string[]> {
	const state = await readSyncState();
	return state.downloadedNovelIds;
}

export async function addDownloadedNovelId(novelId: string): Promise<void> {
	const state = await readSyncState();
	if (!state.downloadedNovelIds.includes(novelId)) {
		state.downloadedNovelIds.push(novelId);
		await writeSyncState(state);
	}
}

export async function removeDownloadedNovelId(novelId: string): Promise<void> {
	const state = await readSyncState();
	state.downloadedNovelIds = state.downloadedNovelIds.filter(
		(id) => id !== novelId,
	);
	state.pendingOps = state.pendingOps.filter((op) => op.novelId !== novelId);
	await writeSyncState(state);
}

export async function setLastSyncAt(timestamp: number): Promise<void> {
	const state = await readSyncState();
	state.lastSyncAt = timestamp;
	await writeSyncState(state);
}

export async function getPendingOpsForEntity(
	entityId: string,
): Promise<SyncOperation[]> {
	const ops = await getPendingOps();
	return ops.filter((op) => op.entityId === entityId);
}

export async function getPendingEntityIds(): Promise<Set<string>> {
	const ops = await getPendingOps();
	return new Set(
		ops
			.filter((op) => op.status === "pending" || op.status === "failed")
			.map((op) => op.entityId),
	);
}
