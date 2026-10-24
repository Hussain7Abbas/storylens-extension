import { expect, test } from "bun:test";
import Dexie from "dexie";
import "../helpers/offline-db";
import { StoryLensDatabase } from "../../src/lib/offline/db";

test("version 1 descriptions and queued edits survive upgrading the local database", async () => {
	const name = `image-description-migration-${crypto.randomUUID()}`;
	const legacy = new Dexie(name);
	// Use the actual v1 index definitions to exercise a real IndexedDB upgrade.
	const schema = new StoryLensDatabase(`${name}-schema`);
	const stores = Object.fromEntries(
		schema.tables.map((table) => [
			table.name,
			[
				table.schema.primKey.src,
				...table.schema.indexes.map((index) => index.src),
			].join(", "),
		]),
	);
	schema.close();
	legacy.version(1).stores(stores);
	await legacy.open();
	await legacy.table("keywordVersions").put({
		id: "version",
		keywordId: "keyword",
		imagePrompt: "A blue-cloaked scout.",
	});
	await legacy.table("keywordAliases").put({
		id: "alias",
		keywordId: "keyword",
		imagePrompt: "A silver-haired scout.",
	});
	await legacy.table("mutations").put({
		id: "mutation",
		patch: { imagePrompt: "My unsynced edit." },
		base: { imagePrompt: "Original." },
	});
	legacy.close();
	const current = new StoryLensDatabase(name);
	try {
		await current.open();
		expect(
			(await current.keywordVersions.get("version"))?.imageDescription,
		).toBe("A blue-cloaked scout.");
		expect((await current.keywordAliases.get("alias"))?.imageDescription).toBe(
			"A silver-haired scout.",
		);
		const mutation = await current.mutations.get(1);
		expect(mutation?.patch).toEqual({ imageDescription: "My unsynced edit." });
		expect(mutation?.base).toEqual({ imageDescription: "Original." });
	} finally {
		await current.delete();
	}
});
