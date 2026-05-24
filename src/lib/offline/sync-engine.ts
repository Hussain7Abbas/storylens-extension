import { getKeywordCategories } from "@/api/endpoints/keyword-categories.js";
import { getKeywordNatures } from "@/api/endpoints/keyword-natures.js";
import {
	deleteKeywordsById,
	getKeywords,
	postKeywords,
	putKeywordsById,
} from "@/api/endpoints/keywords.js";
import {
	deleteReplacementsById,
	getReplacements,
	postReplacements,
	putReplacementsById,
} from "@/api/endpoints/replacements.js";
import type {
	GetKeywords200DataItem,
	PostKeywordsBodyOne,
	PostReplacementsBodyOne,
	PutKeywordsByIdBodyOne,
	PutReplacementsByIdBodyOne,
} from "@/api/schemas";
import {
	replaceKeywordId,
	replaceReplacementId,
	writeNovelOfflineBundle,
} from "@/lib/offline/db";
import { downloadNovel } from "@/lib/offline/download";
import { isOnline } from "@/lib/offline/online-status";
import {
	getDownloadedNovelIds,
	getPendingOps,
	removePendingOp,
	replacePendingEntityId,
	setLastSyncAt,
	updatePendingOp,
} from "@/lib/offline/sync-storage";
import { isTempId, type SyncOperation } from "@/lib/offline/types";
import {
	KEYWORD_LIST_SORTING,
	REPLACEMENT_LIST_SORTING,
	withListQueryParams,
} from "@/utils/api-list-params";

const MAX_SYNC_RETRIES = 5;

export type SyncResult = {
	pushed: number;
	failed: number;
	pulled: number;
};

async function pushOperation(operation: SyncOperation): Promise<void> {
	await updatePendingOp(operation.id, { status: "syncing" });

	try {
		if (operation.entity === "keyword") {
			await pushKeywordOperation(operation);
		} else {
			await pushReplacementOperation(operation);
		}

		await removePendingOp(operation.id);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Sync failed";
		const retryCount = operation.retryCount + 1;
		await updatePendingOp(operation.id, {
			status: retryCount >= MAX_SYNC_RETRIES ? "failed" : "pending",
			retryCount,
			lastError: message,
		});
		throw error;
	}
}

async function pushKeywordOperation(operation: SyncOperation): Promise<void> {
	if (operation.action === "create") {
		const response = await postKeywords(
			operation.payload as PostKeywordsBodyOne,
		);
		const serverKeyword = response.data as GetKeywords200DataItem;

		if (isTempId(operation.entityId)) {
			await replaceKeywordId(operation.entityId, serverKeyword.id);
			await replacePendingEntityId(operation.entityId, serverKeyword.id);
		}
		return;
	}

	if (operation.action === "update") {
		await putKeywordsById(
			operation.entityId,
			operation.payload as PutKeywordsByIdBodyOne,
		);
		return;
	}

	await deleteKeywordsById(operation.entityId);
}

async function pushReplacementOperation(
	operation: SyncOperation,
): Promise<void> {
	if (operation.action === "create") {
		const response = await postReplacements(
			operation.payload as PostReplacementsBodyOne,
		);
		const serverReplacement = response.data;

		if (isTempId(operation.entityId)) {
			await replaceReplacementId(operation.entityId, serverReplacement.id);
			await replacePendingEntityId(operation.entityId, serverReplacement.id);
		}
		return;
	}

	if (operation.action === "update") {
		await putReplacementsById(
			operation.entityId,
			operation.payload as PutReplacementsByIdBodyOne,
		);
		return;
	}

	await deleteReplacementsById(operation.entityId);
}

export async function syncPendingOperations(): Promise<SyncResult> {
	if (!isOnline()) {
		return { pushed: 0, failed: 0, pulled: 0 };
	}

	const operations = await getPendingOps();
	let pushed = 0;
	let failed = 0;

	for (const operation of operations) {
		if (
			operation.status === "failed" &&
			operation.retryCount >= MAX_SYNC_RETRIES
		) {
			continue;
		}

		try {
			await pushOperation(operation);
			pushed += 1;
		} catch {
			failed += 1;
		}
	}

	return { pushed, failed, pulled: 0 };
}

export async function pullServerData(novelId: string): Promise<void> {
	const [
		keywordsResponse,
		replacementsResponse,
		categoriesResponse,
		naturesResponse,
	] = await Promise.all([
		getKeywords(
			withListQueryParams(
				{
					pagination: { page: 1, pageSize: 500 },
					query: { novelId },
				},
				KEYWORD_LIST_SORTING,
			),
		),
		getReplacements(
			withListQueryParams(
				{
					pagination: { page: 1, pageSize: 500 },
					query: { novelId },
				},
				REPLACEMENT_LIST_SORTING,
			),
		),
		getKeywordCategories(
			withListQueryParams({
				pagination: { page: 1, pageSize: 500 },
				sorting: { column: "name", direction: "asc" },
			}),
		),
		getKeywordNatures(
			withListQueryParams({
				pagination: { page: 1, pageSize: 500 },
				sorting: { column: "name", direction: "asc" },
			}),
		),
	]);

	const { getDownloadedNovel } = await import("@/lib/offline/db");
	const novel = await getDownloadedNovel(novelId);
	if (!novel) {
		return;
	}

	await writeNovelOfflineBundle({
		novel,
		keywords: keywordsResponse.data.data,
		replacements: replacementsResponse.data.data,
		categories: categoriesResponse.data.data,
		natures: naturesResponse.data.data,
	});
}

export async function fullSync(): Promise<SyncResult> {
	if (!isOnline()) {
		return { pushed: 0, failed: 0, pulled: 0 };
	}

	const pushResult = await syncPendingOperations();
	const downloadedNovelIds = await getDownloadedNovelIds();
	let pulled = 0;

	for (const novelId of downloadedNovelIds) {
		try {
			await pullServerData(novelId);
			pulled += 1;
		} catch {
			// Server-wins pull failed for this novel; continue with others.
		}
	}

	await setLastSyncAt(Date.now());

	return {
		pushed: pushResult.pushed,
		failed: pushResult.failed,
		pulled,
	};
}

export async function refreshDownloadedNovel(novelId: string): Promise<void> {
	if (!isOnline()) {
		return;
	}

	await downloadNovel(novelId);
}
