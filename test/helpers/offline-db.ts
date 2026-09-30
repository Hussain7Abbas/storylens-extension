import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import {
	OFFLINE_DB_NAME,
	StoryLensDatabase,
	setOfflineDbForTests,
} from "../../src/lib/offline/db";

// Dexie may have loaded before any IndexedDB global existed; point it at the fake one.
Object.assign(globalThis, { indexedDB, IDBKeyRange });
Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

let opened: StoryLensDatabase[] = [];

/** Deletes and reopens the extension database, returning the shared instance. */
export async function freshOfflineDb(): Promise<StoryLensDatabase> {
	for (const db of opened) db.close();
	opened = [];
	const db = new StoryLensDatabase(OFFLINE_DB_NAME);
	await db.delete();
	const fresh = new StoryLensDatabase(OFFLINE_DB_NAME);
	await fresh.open();
	opened.push(fresh);
	setOfflineDbForTests(fresh);
	return fresh;
}

/** Another extension context opening the same database (popup vs background). */
export async function secondContext(): Promise<StoryLensDatabase> {
	const db = new StoryLensDatabase(OFFLINE_DB_NAME);
	await db.open();
	opened.push(db);
	return db;
}
