import { isAxiosError } from "axios";
import {
	deleteKeywordCategoriesById,
	getKeywordCategories,
	postKeywordCategories,
	putKeywordCategoriesById,
} from "@/api/generated/endpoints/keyword-categories.js";
import {
	deleteKeywordNaturesById,
	getKeywordNatures,
	postKeywordNatures,
	putKeywordNaturesById,
} from "@/api/generated/endpoints/keyword-natures.js";
import {
	deleteKeywordAliasesById,
	deleteKeywordsById,
	deleteKeywordVersionsById,
	getKeywords,
	postKeywordAliases,
	postKeywords,
	postKeywordVersions,
	putKeywordAliasesById,
	putKeywordsById,
	putKeywordVersionsById,
} from "@/api/generated/endpoints/keywords.js";
import {
	deleteReplacementsById,
	getReplacements,
	postReplacements,
	putReplacementsById,
} from "@/api/generated/endpoints/replacements.js";
import type {
	GetKeywordCategories200DataItem,
	GetKeywordNatures200DataItem,
	GetKeywords200DataItem,
	PostKeywordAliasesBodyOne,
	PostKeywordCategoriesBodyOne,
	PostKeywordNaturesBodyOne,
	PostKeywordsBodyOne,
	PostKeywordVersionsBodyOne,
	PostReplacementsBodyOne,
	PutKeywordAliasesByIdBodyOne,
	PutKeywordCategoriesByIdBodyOne,
	PutKeywordNaturesByIdBodyOne,
	PutKeywordsByIdBodyOne,
	PutKeywordVersionsByIdBodyOne,
	PutReplacementsByIdBodyOne,
} from "@/api/generated/schemas";
import {
	bulkPutKeywordCategories,
	bulkPutKeywordNatures,
	clearKeywordDirty,
	clearReplacementDirty,
	replaceKeywordAliasId,
	replaceKeywordCategoryId,
	replaceKeywordId,
	replaceKeywordNatureId,
	replaceKeywordVersionId,
	replaceReplacementId,
	saveKeyword,
	saveKeywordAlias,
	saveKeywordVersion,
	saveReplacement,
	writeNovelOfflineBundle,
} from "@/lib/offline/db";
import { downloadNovel } from "@/lib/offline/download";
import { isOnline } from "@/lib/offline/online-status";
import {
	getDownloadedNovelIds,
	getSyncState,
	removePendingOp,
	replacePendingEntityId,
	setLastSyncAt,
	updatePendingOp,
} from "@/lib/offline/sync-storage";
import {
	cleanOfflineKeyword,
	cleanOfflineKeywordAlias,
	cleanOfflineKeywordVersion,
	cleanOfflineReplacement,
	isTempId,
	type SyncOperation,
} from "@/lib/offline/types";
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
	remaining: number;
	errors: {
		entity: string;
		entityId: string;
		message: string;
		status?: number;
	}[];
};

function describeSyncError(error: unknown): {
	message: string;
	status?: number;
} {
	if (isAxiosError<{ message?: string }>(error))
		return {
			message: error.response?.data?.message || error.message,
			status: error.response?.status,
		};
	return { message: error instanceof Error ? error.message : "Sync failed" };
}

async function pushOperation(operation: SyncOperation): Promise<void> {
	await updatePendingOp(operation.id, { status: "syncing" });

	try {
		if (operation.entity === "keyword") {
			await pushKeywordOperation(operation);
		} else if (operation.entity === "keywordAlias") {
			await pushKeywordAliasOperation(operation);
		} else if (operation.entity === "keywordVersion") {
			await pushKeywordVersionOperation(operation);
		} else if (operation.entity === "replacement") {
			await pushReplacementOperation(operation);
		} else if (operation.entity === "keywordCategory") {
			await pushKeywordCategoryOperation(operation);
		} else if (operation.entity === "keywordNature") {
			await pushKeywordNatureOperation(operation);
		} else {
			throw new Error(`Unsupported sync entity: ${operation.entity}`);
		}

		await removePendingOp(operation.id);
	} catch (error) {
		const { message, status } = describeSyncError(error);
		const retryCount = operation.retryCount + 1;
		await updatePendingOp(operation.id, {
			status: retryCount >= MAX_SYNC_RETRIES ? "failed" : "pending",
			retryCount,
			lastError: message,
			lastErrorStatus: status,
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
		await saveKeyword(
			cleanOfflineKeyword(response.data as GetKeywords200DataItem),
		);
		await clearKeywordDirty(operation.entityId);
		return;
	}

	await deleteKeywordsById(operation.entityId);
}

async function pushKeywordAliasOperation(
	operation: SyncOperation,
): Promise<void> {
	if (operation.action === "delete") {
		await deleteKeywordAliasesById(operation.entityId);
		return;
	}
	const response =
		operation.action === "create"
			? await postKeywordAliases(operation.payload as PostKeywordAliasesBodyOne)
			: await putKeywordAliasesById(
					operation.entityId,
					operation.payload as PutKeywordAliasesByIdBodyOne,
				);
	if (isTempId(operation.entityId)) {
		await replaceKeywordAliasId(operation.entityId, response.data.id);
		await replacePendingEntityId(operation.entityId, response.data.id);
	}
	await saveKeywordAlias(cleanOfflineKeywordAlias(response.data));
}

async function pushKeywordVersionOperation(
	operation: SyncOperation,
): Promise<void> {
	if (operation.action === "delete") {
		await deleteKeywordVersionsById(operation.entityId);
		return;
	}
	const response =
		operation.action === "create"
			? await postKeywordVersions(
					operation.payload as PostKeywordVersionsBodyOne,
				)
			: await putKeywordVersionsById(
					operation.entityId,
					operation.payload as PutKeywordVersionsByIdBodyOne,
				);
	if (isTempId(operation.entityId)) {
		await replaceKeywordVersionId(operation.entityId, response.data.id);
		await replacePendingEntityId(operation.entityId, response.data.id);
	}
	await saveKeywordVersion(cleanOfflineKeywordVersion(response.data));
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
	const locale = (() => {
		try {
			return JSON.parse(localStorage.getItem("locale") ?? '"en"');
		} catch {
			return "en";
		}
	})();
	const nameSortCol = locale === "ar" ? "nameAr" : "nameEn";

	const [categoriesResponse, naturesResponse] = await Promise.all([
		getKeywordCategories(
			withListQueryParams({
				pagination: { page: 1, pageSize: 500 },
				sorting: { column: nameSortCol, direction: "asc" },
			}),
		),
		getKeywordNatures(
			withListQueryParams({
				pagination: { page: 1, pageSize: 500 },
				sorting: { column: nameSortCol, direction: "asc" },
			}),
		),
	]);

	await bulkPutKeywordCategories(categoriesResponse.data.data);
	await bulkPutKeywordNatures(naturesResponse.data.data);
}

let pendingSync: Promise<SyncResult> | undefined;

export function syncPendingOperations(
	retryFailed = false,
): Promise<SyncResult> {
	if (pendingSync) return pendingSync;
	pendingSync = pushPendingOperations(retryFailed).finally(() => {
		pendingSync = undefined;
	});
	return pendingSync;
}

async function pushPendingOperations(
	retryFailed: boolean,
): Promise<SyncResult> {
	if (!isOnline()) throw new Error("Sync requires an internet connection");
	const operations = (await getSyncState()).pendingOps;
	let pushed = 0;
	const errors: SyncResult["errors"] = [];
	for (const queued of operations) {
		// Reload so dependent operations use IDs mapped by earlier creates.
		const operation = (await getSyncState()).pendingOps.find(
			(op) => op.id === queued.id,
		);
		if (!operation) continue;
		if (
			!retryFailed &&
			operation.status === "failed" &&
			operation.retryCount >= MAX_SYNC_RETRIES
		) {
			errors.push({
				entity: operation.entity,
				entityId: operation.entityId,
				message: operation.lastError || "Retry limit reached",
				status: operation.lastErrorStatus,
			});
			continue;
		}
		try {
			await pushOperation(operation);
			pushed += 1;
		} catch (error) {
			errors.push({
				entity: operation.entity,
				entityId: operation.entityId,
				...describeSyncError(error),
			});
		}
	}
	return {
		pushed,
		failed: errors.length,
		pulled: 0,
		remaining: (await getSyncState()).pendingOps.length,
		errors,
	};
}

export async function pullServerData(novelId: string): Promise<void> {
	const locale = (() => {
		try {
			return JSON.parse(localStorage.getItem("locale") ?? '"en"');
		} catch {
			return "en";
		}
	})();
	const nameSortCol = locale === "ar" ? "nameAr" : "nameEn";

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
				sorting: { column: nameSortCol, direction: "asc" },
			}),
		),
		getKeywordNatures(
			withListQueryParams({
				pagination: { page: 1, pageSize: 500 },
				sorting: { column: nameSortCol, direction: "asc" },
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

let activeFullSync: Promise<SyncResult> | undefined;

export function fullSync(retryFailed = false): Promise<SyncResult> {
	if (activeFullSync) return activeFullSync;
	activeFullSync = runFullSync(retryFailed).finally(() => {
		activeFullSync = undefined;
	});
	return activeFullSync;
}

async function runFullSync(retryFailed: boolean): Promise<SyncResult> {
	if (!isOnline()) {
		throw new Error("Sync requires an internet connection");
	}

	const pushResult = await syncPendingOperations(retryFailed);
	const errors = [...pushResult.errors];
	const unresolved = (await getSyncState()).pendingOps;
	const hasUnresolvedLookups = unresolved.some(
		(op) => op.entity === "keywordCategory" || op.entity === "keywordNature",
	);

	try {
		if (!hasUnresolvedLookups) await pullLookupData();
	} catch (error) {
		errors.push({
			entity: "lookups",
			entityId: "global",
			...describeSyncError(error),
		});
	}

	const downloadedNovelIds = await getDownloadedNovelIds();
	let pulled = 0;

	for (const novelId of downloadedNovelIds) {
		// Preserve local aliases and versions while their writes remain unresolved.
		if (hasUnresolvedLookups || unresolved.some((op) => op.novelId === novelId))
			continue;
		try {
			await pullServerData(novelId);
			pulled += 1;
		} catch (error) {
			errors.push({
				entity: "novel",
				entityId: novelId,
				...describeSyncError(error),
			});
		}
	}

	const remaining = (await getSyncState()).pendingOps.length;
	if (errors.length === 0 && remaining === 0) await setLastSyncAt(Date.now());

	return {
		pushed: pushResult.pushed,
		failed: errors.length,
		errors,
		remaining,
		pulled,
	};
}

export async function refreshDownloadedNovel(novelId: string): Promise<void> {
	if (!isOnline()) {
		return;
	}

	await downloadNovel(novelId);
}
