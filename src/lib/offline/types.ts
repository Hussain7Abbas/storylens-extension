import type {
	GetKeywordCategories200DataItem,
	GetKeywordNatures200DataItem,
	GetKeywords200DataItem,
	GetKeywords200DataItemAliasesItem,
	GetKeywords200DataItemVersionsItem,
	GetNovels200DataItem,
	GetReplacements200DataItem,
	GetWebsiteNovelBiases200Item,
} from "@/api/generated/schemas";

// ---------------------------------------------------------------------------
// Snapshot rows: what the server last said, in the generated API shapes.
// ---------------------------------------------------------------------------

export type CatalogNovel = GetNovels200DataItem;
/** A keyword row without embedded children; aliases and versions have their own tables. */
export type KeywordRow = Omit<GetKeywords200DataItem, "aliases" | "versions">;
export type AliasRow = GetKeywords200DataItemAliasesItem;
export type VersionRow = GetKeywords200DataItemVersionsItem;
export type ReplacementRow = GetReplacements200DataItem;
export type CategoryRow = GetKeywordCategories200DataItem;
export type NatureRow = GetKeywordNatures200DataItem;
export type BiasRow = GetWebsiteNovelBiases200Item;

/** A keyword as the UI and page highlighting read it: with its aliases and versions. */
export type AssembledKeyword = GetKeywords200DataItem;

// Kept for UI modules that name these shapes.
export type OfflineKeywordCategory = CategoryRow;
export type OfflineKeywordNature = NatureRow;
export type OfflineWebsiteNovelBias = BiasRow;
export type OfflineReplacement = ReplacementRow;

/** Per-novel sync bookkeeping; `pinned` marks a downloaded novel. */
export type NovelSync = {
	novelId: string;
	/** 1 when downloaded (IndexedDB cannot index booleans). */
	pinned: 0 | 1;
	downloadedAt?: number;
	lastPulledAt?: number;
	/** Set when the page or popup asked for a fresher copy of a cached novel. */
	refreshRequestedAt?: number;
	/** A push outcome (chain rewrite, missing parent) needs the novel pulled again. */
	pullDue?: boolean;
	lastPullError?: string;
	removedOnServer?: boolean;
	/** Change-feed cursor for delta refreshes (phase 9). */
	cursor?: number;
	/** Last full pull, for the weekly reconciliation. */
	lastFullPullAt?: number;
};

export type SyncMetaRow = { key: string; value: unknown };

/** An image kept on the device until its upload is sent (phase 8). */
export type QueuedFile = {
	id: string;
	mutationId: string;
	blob: Blob;
	name: string;
	type: string;
	size: number;
	createdAt: number;
};

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

export type SyncEntity =
	| "keyword"
	| "keywordAlias"
	| "keywordVersion"
	| "replacement"
	| "keywordCategory"
	| "keywordNature"
	| "file";

export type MutationOp = "create" | "update" | "delete";

export type MutationStatus = "pending" | "inflight" | "conflict" | "rejected";

export type ConflictKind =
	| "stale"
	| "deleted"
	| "duplicate"
	| "rule"
	| "permission"
	| "parent-missing";

export type FieldConflict = {
	field: string;
	base: unknown;
	mine: unknown;
	theirs: unknown;
};

/** One create, update or delete of one entity, waiting to be sent. */
export type Mutation = {
	/** Dexie auto-increment: global order. */
	seq?: number;
	/** UUID; also the idempotency key in logs. */
	id: string;
	/** Account that made the change; only it sends or sees the change. */
	userId: string;
	/** Username, for "made while signed in as …". */
	userLabel: string;
	entity: SyncEntity;
	op: MutationOp;
	/** Client-generated UUID for creates. */
	entityId: string;
	/** Null for categories, natures and files. */
	novelId: string | null;
	/** The keyword of an alias or version. */
	parentId?: string;
	/** Entity IDs whose creates must be confirmed first. */
	dependsOn: string[];
	/** Create: the full body. Update: changed fields only. */
	patch: Record<string, unknown>;
	/** Update: the values the reader saw for the patched fields. */
	base?: Record<string, unknown>;
	/** Update: the row's server `updatedAt` when the edit started. */
	baseUpdatedAt?: string;
	/** Permissions at edit time; the projection mirrors what the server will allow. */
	actor: { moderator: boolean };
	createdAt: number;
	updatedAt: number;
	status: MutationStatus;
	/** Transient failures only. */
	attempts: number;
	nextAttemptAt: number;
	leaseUntil?: number;
	lastError?: { status?: number; code?: string; message: string; at: number };
	conflict?: {
		kind: ConflictKind;
		server?: Record<string, unknown> | null;
		fields?: FieldConflict[];
		hint?: "create-again";
	};
};

/** Badge state of one entity in a view. */
export type EntitySyncState = "pending" | "conflict" | "rejected" | "missing";

export type NovelView = {
	novel: CatalogNovel | undefined;
	keywords: AssembledKeyword[];
	replacements: ReplacementRow[];
	biases: BiasRow[];
	/** Sync state per entity ID (pending, needs attention) for badges. */
	states: Map<string, EntitySyncState>;
};

export type LookupsView = {
	categories: CategoryRow[];
	natures: NatureRow[];
	states: Map<string, EntitySyncState>;
};
