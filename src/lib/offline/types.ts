import type {
	GetKeywordCategories200DataItem,
	GetKeywordNatures200DataItem,
	GetKeywords200DataItem,
	GetNovels200DataItem,
	GetReplacements200DataItem,
} from "@/api/schemas";

export type SyncEntity =
	| "keyword"
	| "replacement"
	| "keywordCategory"
	| "keywordNature";

export const GLOBAL_LOOKUP_SCOPE = "global";

export type SyncAction = "create" | "update" | "delete";

export type SyncOperationStatus = "pending" | "syncing" | "failed";

export type SyncOperation = {
	id: string;
	entity: SyncEntity;
	action: SyncAction;
	entityId: string;
	novelId: string;
	payload: Record<string, unknown>;
	createdAt: number;
	status: SyncOperationStatus;
	retryCount: number;
	lastError?: string;
};

export type SyncState = {
	pendingOps: SyncOperation[];
	lastSyncAt: number;
	downloadedNovelIds: string[];
};

export type DownloadedNovel = GetNovels200DataItem & {
	downloadedAt: number;
};

export type OfflineKeyword = GetKeywords200DataItem;

export type OfflineReplacement = GetReplacements200DataItem;

export type OfflineKeywordCategory = GetKeywordCategories200DataItem;

export type OfflineKeywordNature = GetKeywordNatures200DataItem;

export const DEFAULT_SYNC_STATE: SyncState = {
	pendingOps: [],
	lastSyncAt: 0,
	downloadedNovelIds: [],
};

export const SYNC_STORAGE_KEY = "storylens-sync-state";

export function createTempId(): string {
	return `temp-${crypto.randomUUID()}`;
}

export function isTempId(id: string): boolean {
	return id.startsWith("temp-");
}
