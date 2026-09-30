import Dexie, { type EntityTable, type Table } from "dexie";
import type {
	AliasRow,
	BiasRow,
	CatalogNovel,
	CategoryRow,
	KeywordRow,
	Mutation,
	NatureRow,
	NovelSync,
	QueuedFile,
	ReplacementRow,
	SyncMetaRow,
	VersionRow,
} from "@/lib/offline/types";

export const OFFLINE_DB_NAME = "storylens";

/**
 * The extension's local store, shared by every extension context (IndexedDB
 * transactions are atomic across them). Snapshot tables hold server rows only;
 * `mutations` is the outbox. One schema, no upgrade chain: a schema change that
 * needs a data change gets its own, explicitly planned migration.
 */
export class StoryLensDatabase extends Dexie {
	novels!: EntityTable<CatalogNovel, "id">;
	keywords!: EntityTable<KeywordRow, "id">;
	keywordAliases!: EntityTable<AliasRow, "id">;
	keywordVersions!: EntityTable<VersionRow, "id">;
	replacements!: EntityTable<ReplacementRow, "id">;
	keywordCategories!: EntityTable<CategoryRow, "id">;
	keywordNatures!: EntityTable<NatureRow, "id">;
	websiteNovelBiases!: EntityTable<BiasRow, "id">;
	mutations!: Table<Mutation, number>;
	novelSync!: EntityTable<NovelSync, "novelId">;
	syncMeta!: EntityTable<SyncMetaRow, "key">;
	files!: EntityTable<QueuedFile, "id">;

	constructor(name = OFFLINE_DB_NAME) {
		super(name);
		this.version(1).stores({
			// Snapshot: server rows only, in the generated API shapes
			novels: "id",
			keywords: "id, novelId",
			keywordAliases: "id, keywordId",
			keywordVersions: "id, keywordId",
			replacements: "id, novelId",
			keywordCategories: "id",
			keywordNatures: "id",
			websiteNovelBiases: "id, novelId",
			// Local state
			mutations:
				"++seq, &id, entityId, novelId, status, userId, [userId+status]",
			novelSync: "novelId, pinned",
			syncMeta: "key",
			files: "id, mutationId",
		});
	}
}

let current: StoryLensDatabase | undefined;
let unavailable = false;

/** The shared database instance of this context. */
export function offlineDb(): StoryLensDatabase {
	current ??= new StoryLensDatabase();
	return current;
}

/**
 * Opens the database, or marks offline storage unavailable (for example Firefox
 * with site data blocked) so the UI falls back to online-only mode with a banner
 * instead of failing. The flag lives in memory: the database cannot hold it.
 */
export async function openOfflineDb(): Promise<StoryLensDatabase | null> {
	try {
		const db = offlineDb();
		if (!db.isOpen()) await db.open();
		unavailable = false;
		return db;
	} catch (error) {
		console.warn("[StoryLens] Offline storage is unavailable", error);
		unavailable = true;
		return null;
	}
}

export function isOfflineUnavailable(): boolean {
	return unavailable;
}

/** Tests: use another instance (a second extension context) or reset between tests. */
export function setOfflineDbForTests(db: StoryLensDatabase | undefined): void {
	current = db;
	unavailable = false;
}

/** Every snapshot and local table, for transactions that span them. */
export function allTables(db: StoryLensDatabase): Table[] {
	return [
		db.novels,
		db.keywords,
		db.keywordAliases,
		db.keywordVersions,
		db.replacements,
		db.keywordCategories,
		db.keywordNatures,
		db.websiteNovelBiases,
		db.mutations,
		db.novelSync,
		db.syncMeta,
		db.files,
	];
}
