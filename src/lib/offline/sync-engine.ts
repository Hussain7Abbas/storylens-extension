import {
	deleteKeywordCategoriesById,
	getKeywordCategories,
	postKeywordCategories,
	putKeywordCategoriesById,
} from "@/api/endpoints/keyword-categories.js";
import {
	deleteKeywordNaturesById,
	getKeywordNatures,
	postKeywordNatures,
	putKeywordNaturesById,
} from "@/api/endpoints/keyword-natures.js";
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
	GetKeywordCategories200DataItem,
	GetKeywordNatures200DataItem,
	GetKeywords200DataItem,
	PostKeywordCategoriesBodyOne,
	PostKeywordNaturesBodyOne,
	PostKeywordsBodyOne,
	PostReplacementsBodyOne,
	PutKeywordCategoriesByIdBodyOne,
	PutKeywordNaturesByIdBodyOne,
	PutKeywordsByIdBodyOne,
	PutReplacementsByIdBodyOne,
} from "@/api/schemas";
import {
	bulkPutKeywordCategories,
	bulkPutKeywordNatures,
	clearKeywordDirty,
	clearReplacementDirty,
	replaceKeywordCategoryId,
	replaceKeywordId,
	replaceKeywordNatureId,
	replaceReplacementId,
	saveKeyword,
	saveReplacement,
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
import { cleanOfflineKeyword, cleanOfflineReplacement } from "@/lib/offline/types";
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
		} else if (operation.entity === "replacement") {
			await pushReplacementOperation(operation);
		} else if (operation.entity === "keywordCategory") {
			await pushKeywordCategoryOperation(operation);
		} else {
			await pushKeywordNatureOperation(operation);
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
		} else {
			await saveKeyword(cleanOfflineKeyword(serverKeyword));
		}
		return;
	}

	if (operation.action === "update") {
		const response = await putKeywordsById(
			operation.entityId,
			operation.payload as PutKeywordsByIdBodyOne,
		);
		await saveKeyword(cleanOfflineKeyword(response.data as GetKeywords200DataItem));
		await clearKeywordDirty(operation.entityId);
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
		} else {
			await saveReplacement(cleanOfflineReplacement(serverReplacement));
		}
		return;
	}

	if (operation.action === "update") {
		const response = await putReplacementsById(
			operation.entityId,
			operation.payload as PutReplacementsByIdBodyOne,
		);
		await saveReplacement(cleanOfflineReplacement(response.data));
		await clearReplacementDirty(operation.entityId);
		return;
	}

	await deleteReplacementsById(operation.entityId);
}

async function pushKeywordCategoryOperation(
	operation: SyncOperation,
): Promise<void> {
	if (operation.action === "create") {
		const response = await postKeywordCategories(
			operation.payload as PostKeywordCategoriesBodyOne,
		);
		const serverCategory = response.data as GetKeywordCategories200DataItem;

		if (isTempId(operation.entityId)) {
			await replaceKeywordCategoryId(operation.entityId, serverCategory.id);
			await replacePendingEntityId(operation.entityId, serverCategory.id);
		}
		return;
	}

	if (operation.action === "update") {
		await putKeywordCategoriesById(
			operation.entityId,
			operation.payload as PutKeywordCategoriesByIdBodyOne,
		);
		return;
	}

	await deleteKeywordCategoriesById(operation.entityId);
}

async function pushKeywordNatureOperation(
	operation: SyncOperation,
): Promise<void> {
	if (operation.action === "create") {
		const response = await postKeywordNatures(
			operation.payload as PostKeywordNaturesBodyOne,
		);
		const serverNature = response.data as GetKeywordNatures200DataItem;

		if (isTempId(operation.entityId)) {
			await replaceKeywordNatureId(operation.entityId, serverNature.id);
			await replacePendingEntityId(operation.entityId, serverNature.id);
		}
		return;
	}

	if (operation.action === "update") {
		await putKeywordNaturesById(
			operation.entityId,
			operation.payload as PutKeywordNaturesByIdBodyOne,
		);
		return;
	}

	await deleteKeywordNaturesById(operation.entityId);
}

export async function pullLookupData(): Promise<void> {
	const [categoriesResponse, naturesResponse] = await Promise.all([
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

	await bulkPutKeywordCategories(categoriesResponse.data.data);
	await bulkPutKeywordNatures(naturesResponse.data.data);
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

	try {
		await pullLookupData();
	} catch {
		// Lookup pull failed; continue with novel pulls.
	}

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
