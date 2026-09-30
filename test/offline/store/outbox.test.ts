/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import {
	makeUser,
	secondContext,
	setupEngine,
	signIn,
} from "../../helpers/engine";
import { fakeBrowser } from "../../helpers/fake-browser";

const {
	enqueue,
	planDelete,
	discardMutation,
	applyResolution,
	PermissionDenied,
	ValidationFailed,
	NotSignedIn,
} = await import("../../../src/lib/offline/outbox");
const { getNovelView, getLookupsView } = await import(
	"../../../src/lib/offline/views"
);
const { pullNovel, pullLookups } = await import(
	"../../../src/lib/offline/sync/pull"
);
const { upsertRows } = await import("../../../src/lib/offline/snapshot");
const { projectNovel } = await import("../../../src/lib/offline/projection");
const {
	deleteOldStorage,
	resetOldStorageCleanupForTests,
	OLD_DB_NAME,
	OLD_POOL_KEY,
} = await import("../../../src/lib/offline/upgrade-cleanup");
const {
	openOfflineDb,
	isOfflineUnavailable,
	setOfflineDbForTests,
	StoryLensDatabase,
} = await import("../../../src/lib/offline/db");
const Dexie = (await import("dexie")).default;

type Env = Awaited<ReturnType<typeof setupEngine>>;
let env: Env;
const token = "token-reader-1";

async function pull() {
	await pullLookups({ db: env.db, token });
	await pullNovel(env.novel.id, { db: env.db, token });
}

async function view() {
	return getNovelView(env.novel.id, env.user.id, env.db);
}

async function outbox() {
	return (await env.db.mutations.toArray()).sort(
		(left, right) => (left.seq ?? 0) - (right.seq ?? 0),
	);
}

const keywordValues = () => ({
	nameEn: "Mira",
	categoryId: env.category.id,
	natureId: env.nature.id,
	description: "d",
});

beforeEach(async () => {
	env = await setupEngine();
	await pull();
});

describe("enqueue", () => {
	it("creates a keyword with its base version in the view and one outbox mutation", async () => {
		const result = await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: keywordValues(),
			},
			{ db: env.db },
		);
		const keyword = (await view()).keywords.find(
			(item) => item.id === result.entityId,
		);
		expect(keyword?.nameEn).toBe("Mira");
		expect(keyword?.createdById).toBe(env.user.id);
		expect(
			keyword?.versions.map((version) => [
				version.id,
				Number(version.startingChapter),
				version.description,
			]),
		).toEqual([[result.versionId as string, 0, "d"]]);
		expect(keyword?.versions[0]?.category?.id).toBe(env.category.id);
		expect((await outbox()).length).toBe(1);
	});

	it("refuses signed-out and guest users before writing", async () => {
		await signIn(null);
		await expect(
			enqueue(
				{
					entity: "keyword",
					op: "create",
					novelId: env.novel.id,
					values: keywordValues(),
				},
				{ db: env.db },
			),
		).rejects.toBeInstanceOf(NotSignedIn);
		await signIn(makeUser("g", { guest: true }));
		await expect(
			enqueue(
				{
					entity: "keyword",
					op: "create",
					novelId: env.novel.id,
					values: keywordValues(),
				},
				{ db: env.db },
			),
		).rejects.toBeInstanceOf(NotSignedIn);
		expect(await outbox()).toEqual([]);
	});

	it("folds updates into an unsent create and cancels create + delete with children", async () => {
		const { entityId, versionId } = await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: keywordValues(),
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: entityId,
				changes: { nameEn: "Mira Vale" },
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keywordVersion",
				op: "update",
				id: versionId as string,
				changes: { description: "base edit", natureId: env.nature.id },
			},
			{ db: env.db },
		);
		let queued = await outbox();
		expect(queued.length).toBe(1);
		expect(queued[0]?.patch).toMatchObject({
			nameEn: "Mira Vale",
			description: "base edit",
		});

		const alias = await enqueue(
			{
				entity: "keywordAlias",
				op: "create",
				keywordId: entityId,
				values: { nameEn: "Little Mira" },
			},
			{ db: env.db },
		);
		queued = await outbox();
		expect(
			queued.find((item) => item.entityId === alias.entityId)?.dependsOn,
		).toEqual([entityId]);
		expect(
			(await planDelete(entityId, { db: env.db, userId: env.user.id })).map(
				(item) => item.entityId,
			),
		).toEqual([alias.entityId]);
		const deleted = await enqueue(
			{ entity: "keyword", op: "delete", id: entityId },
			{ db: env.db },
		);
		expect(deleted.mutationId).toBeNull();
		expect(await outbox()).toEqual([]);
		expect(
			(await view()).keywords.find((item) => item.id === entityId),
		).toBeUndefined();
	});

	it("merges update into update keeping the first base, and replaces update with delete", async () => {
		const server = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Bram", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		await pull();
		const seen = { nameEn: "Bram" };
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: server.id,
				changes: { nameEn: "Bram 2" },
				seen,
				seenUpdatedAt: server.updatedAt as string,
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: server.id,
				changes: { matchingType: "PARTIAL" },
			},
			{ db: env.db },
		);
		let queued = await outbox();
		expect(queued.length).toBe(1);
		expect(queued[0]?.patch).toEqual({
			nameEn: "Bram 2",
			matchingType: "PARTIAL",
		});
		expect(queued[0]?.base).toEqual({ nameEn: "Bram", matchingType: "FULL" });
		expect(queued[0]?.baseUpdatedAt).toBe(server.updatedAt as string);
		await enqueue(
			{ entity: "keyword", op: "delete", id: server.id },
			{ db: env.db },
		);
		queued = await outbox();
		expect([queued.length, queued[0]?.op]).toEqual([1, "delete"]);
	});

	it("appends behind an in-flight tail with its own base", async () => {
		const server = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Cora", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		await pull();
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: server.id,
				changes: { nameEn: "Cora 2" },
			},
			{ db: env.db },
		);
		const [first] = await outbox();
		await env.db.mutations.update(first?.seq as number, { status: "inflight" });
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: server.id,
				changes: { matchingType: "PARTIAL" },
			},
			{ db: env.db },
		);
		const queued = await outbox();
		expect(queued.length).toBe(2);
		expect(queued[1]?.base).toEqual({ matchingType: "FULL" });
	});

	it("writes nothing for an unchanged form", async () => {
		const server = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Dan", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		await pull();
		const result = await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: server.id,
				changes: { nameEn: "Dan" },
			},
			{ db: env.db },
		);
		expect(result.mutationId).toBeNull();
	});

	it("refuses what the server would refuse, writing nothing", async () => {
		const other = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Taken", categoryId: env.category.id, natureId: env.nature.id },
			"someone-else",
		);
		await pull();
		const refuse = async (
			input: Parameters<typeof enqueue>[0],
			code: string,
		) => {
			const error = await enqueue(input, { db: env.db }).catch(
				(caught) => caught,
			);
			expect(error).toBeInstanceOf(ValidationFailed);
			expect((error as InstanceType<typeof ValidationFailed>).code).toBe(
				code as never,
			);
		};
		await refuse(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: { ...keywordValues(), nameEn: "Taken" },
			},
			"KEYWORD_NAME_TAKEN",
		);
		await refuse(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: { ...keywordValues(), nameEn: " " },
			},
			"NAME_REQUIRED",
		);
		const baseId = (await view()).keywords.find((item) => item.id === other.id)
			?.versions[0]?.id as string;
		await refuse(
			{
				entity: "keywordVersion",
				op: "create",
				keywordId: other.id,
				values: {},
			},
			"VERSION_CHAPTER_REQUIRED",
		);
		await refuse(
			{
				entity: "keywordVersion",
				op: "create",
				keywordId: other.id,
				values: { currentChapter: 0 },
			},
			"VERSION_NOT_AFTER_LATEST",
		);
		const error = await enqueue(
			{ entity: "keywordVersion", op: "delete", id: baseId },
			{ db: env.db },
		).catch((caught) => caught);
		expect(error).toBeInstanceOf(PermissionDenied);
		expect(await outbox()).toEqual([]);
	});

	it("applies the D12 rules", async () => {
		const others = env.api.seedKeyword(
			env.novel.id,
			{
				nameEn: "Theirs",
				categoryId: env.category.id,
				natureId: env.nature.id,
			},
			"someone-else",
		);
		await pull();
		await expect(
			enqueue(
				{
					entity: "keyword",
					op: "update",
					id: others.id,
					changes: { nameEn: "Mine now" },
				},
				{ db: env.db },
			),
		).rejects.toBeInstanceOf(PermissionDenied);
		const alias = await enqueue(
			{
				entity: "keywordAlias",
				op: "create",
				keywordId: others.id,
				values: { nameEn: "My alias" },
			},
			{ db: env.db },
		);
		const renamed = await enqueue(
			{
				entity: "keywordAlias",
				op: "update",
				id: alias.entityId,
				changes: { nameEn: "My alias 2" },
			},
			{ db: env.db },
		);
		expect(renamed.mutationId).not.toBeNull();
		await expect(
			enqueue(
				{
					entity: "keywordCategory",
					op: "create",
					values: { nameEn: "New", color: "#000000" },
				},
				{ db: env.db },
			),
		).rejects.toBeInstanceOf(PermissionDenied);
	});

	it("keeps every enqueue from two contexts with strictly increasing seq", async () => {
		const popup = await secondContext();
		await Promise.all(
			Array.from({ length: 50 }, (_, index) =>
				enqueue(
					{
						entity: "replacement",
						op: "create",
						novelId: env.novel.id,
						values: { from: `from-${index}`, to: `to-${index}` },
					},
					{ db: index % 2 ? popup : env.db },
				),
			),
		);
		const queued = await outbox();
		expect(queued.length).toBe(50);
		const seqs = queued.map((item) => item.seq as number);
		expect(new Set(seqs).size).toBe(50);
		expect([...seqs].sort((left, right) => left - right)).toEqual(seqs);
	});

	it("resolves conflicts field by field and discards with dependants", async () => {
		const server = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Eve", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		await pull();
		const { mutationId } = await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: server.id,
				changes: { nameEn: "Eve 2", matchingType: "PARTIAL" },
			},
			{ db: env.db },
		);
		const [row] = await outbox();
		await env.db.mutations.update(row?.seq as number, {
			status: "conflict",
			conflict: {
				kind: "stale",
				server: {
					id: server.id,
					nameEn: "Eve 3",
					matchingType: "FULL",
					updatedAt: "2030-01-01T00:00:00.000Z",
				},
				fields: [
					{ field: "nameEn", base: "Eve", mine: "Eve 2", theirs: "Eve 3" },
				],
			},
		});
		expect(
			await applyResolution(
				mutationId as string,
				{ kind: "fields", choices: { nameEn: "theirs" } },
				{ db: env.db },
			),
		).toBe("pending");
		const [resolved] = await outbox();
		expect(resolved?.patch).toEqual({ matchingType: "PARTIAL" });
		expect([resolved?.status, resolved?.baseUpdatedAt]).toEqual([
			"pending",
			"2030-01-01T00:00:00.000Z",
		]);

		const created = await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: keywordValues(),
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keywordAlias",
				op: "create",
				keywordId: created.entityId,
				values: { nameEn: "Child" },
			},
			{ db: env.db },
		);
		const removed = await discardMutation(created.mutationId as string, {
			db: env.db,
		});
		expect(removed.length).toBe(2);
		expect((await outbox()).length).toBe(1);
	});
});

describe("projection", () => {
	it("mirrors the server: version auto-close, chain rewrite, cascades", async () => {
		const keyword = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Hub", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		await pull();
		await enqueue(
			{
				entity: "keywordVersion",
				op: "create",
				keywordId: keyword.id,
				values: { currentChapter: 10, description: "later" },
			},
			{ db: env.db },
		);
		const versions =
			(await view()).keywords.find((item) => item.id === keyword.id)
				?.versions ?? [];
		expect(
			versions.map((version) => [
				Number(version.startingChapter),
				version.endingChapter,
			]),
		).toEqual([
			[0, 9],
			[10, null],
		]);

		await enqueue(
			{
				entity: "replacement",
				op: "create",
				novelId: env.novel.id,
				values: { from: "a", to: "b" },
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "replacement",
				op: "create",
				novelId: env.novel.id,
				values: { from: "b", to: "Hub" },
			},
			{ db: env.db },
		);
		const replacements = (await view()).replacements;
		expect(replacements.find((row) => row.from === "a")?.to).toBe("Hub");
		expect(replacements.find((row) => row.from === "a")?.keywordId).toBe(
			keyword.id,
		);

		await enqueue(
			{ entity: "keyword", op: "delete", id: keyword.id },
			{ db: env.db },
		);
		const after = await view();
		expect(
			after.keywords.find((item) => item.id === keyword.id),
		).toBeUndefined();
		expect(
			after.replacements.every((row) => row.keywordId !== keyword.id),
		).toBe(true);
	});

	it("is idempotent, ignores other accounts and shows raw text", async () => {
		const snapshot = {
			novel: undefined,
			keywords: [],
			aliases: [],
			versions: [],
			replacements: [],
			biases: [],
		};
		await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: { ...keywordValues(), nameEn: "O'Brien <b>" },
			},
			{ db: env.db },
		);
		const mutations = await outbox();
		const once = projectNovel({
			novelId: env.novel.id,
			snapshot,
			mutations,
			userId: env.user.id,
		});
		const twice = projectNovel({
			novelId: env.novel.id,
			snapshot,
			mutations: [...mutations, ...mutations],
			userId: env.user.id,
		});
		expect(twice.keywords.map((item) => item.nameEn)).toEqual(
			once.keywords.map((item) => item.nameEn),
		);
		expect(once.keywords[0]?.nameEn).toBe("O'Brien <b>");
		expect(
			projectNovel({
				novelId: env.novel.id,
				snapshot,
				mutations,
				userId: "someone-else",
			}).keywords,
		).toEqual([]);
	});

	it("embeds renamed and recoloured lookups on versions and aliases", async () => {
		env = await setupEngine({ moderator: true });
		await pull();
		const keyword = env.api.seedKeyword(
			env.novel.id,
			{
				nameEn: "Styled",
				categoryId: env.category.id,
				natureId: env.nature.id,
			},
			env.user.id,
		);
		await pull();
		await enqueue(
			{
				entity: "keywordAlias",
				op: "create",
				keywordId: keyword.id,
				values: { nameEn: "Alias", categoryId: env.category.id },
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keywordCategory",
				op: "update",
				id: env.category.id,
				changes: { nameEn: "Villain", color: "#ff0000" },
			},
			{ db: env.db },
		);
		const styled = (await view()).keywords.find(
			(item) => item.id === keyword.id,
		);
		expect(styled?.versions[0]?.category).toMatchObject({
			nameEn: "Villain",
			color: "#ff0000",
		});
		expect(styled?.aliases[0]?.category).toMatchObject({
			nameEn: "Villain",
			color: "#ff0000",
		});
		expect(
			(await getLookupsView(env.user.id, env.db)).categories.find(
				(row) => row.id === env.category.id,
			)?.nameEn,
		).toBe("Villain");
	});

	it("builds a large view quickly", async () => {
		const keywords = Array.from({ length: 2000 }, (_, index) => ({
			id: `k${index}`,
			nameAr: null,
			nameEn: `K${index}`,
			matchingType: "FULL",
			novelId: "n",
			createdById: null,
			createdAt: "t",
			updatedAt: "t",
		}));
		const aliases = keywords.map((keyword, index) => ({
			id: `a${index}`,
			keywordId: keyword.id,
			nameAr: null,
			nameEn: `A${index}`,
			description: null,
			matchingType: "FULL",
			overrideStyle: false,
			categoryId: null,
			natureId: null,
			imageId: null,
			createdById: null,
			createdAt: "t",
			updatedAt: "t",
			category: null,
			nature: null,
			image: null,
		}));
		const versions = keywords.map((keyword, index) => ({
			id: `v${index}`,
			keywordId: keyword.id,
			description: null,
			startingChapter: 0,
			endingChapter: null,
			categoryId: null,
			natureId: null,
			imageId: null,
			createdById: null,
			createdAt: "t",
			updatedAt: "t",
			category: null,
			nature: null,
			image: null,
		}));
		const mutations = Array.from({ length: 200 }, (_, index) => ({
			seq: index,
			id: `m${index}`,
			userId: "u",
			userLabel: "u",
			entity: "keyword" as const,
			op: "update" as const,
			entityId: `k${index}`,
			novelId: "n",
			dependsOn: [],
			patch: { nameEn: `K${index}!` },
			actor: { moderator: false },
			createdAt: 0,
			updatedAt: 0,
			status: "pending" as const,
			attempts: 0,
			nextAttemptAt: 0,
		}));
		const started = performance.now();
		const built = projectNovel({
			novelId: "n",
			snapshot: {
				keywords,
				aliases,
				versions,
				replacements: [],
				biases: [],
			} as never,
			mutations,
			userId: "u",
		});
		const elapsed = performance.now() - started;
		console.log(
			`[perf] projection of 2,000 keywords, 4,000 aliases and versions, 200 mutations: ${elapsed.toFixed(1)} ms`,
		);
		expect(built.keywords.length).toBe(2000);
		expect(elapsed).toBeLessThan(100);
	});
});

describe("snapshot writers", () => {
	it("keep local intent through a pull, and mark updates of removed rows deleted", async () => {
		const keyword = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Pull", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		await pull();
		const created = await enqueue(
			{
				entity: "keywordAlias",
				op: "create",
				keywordId: keyword.id,
				values: { nameEn: "New alias" },
			},
			{ db: env.db },
		);
		await pull();
		expect(
			(await view()).keywords
				.find((item) => item.id === keyword.id)
				?.aliases.map((alias) => alias.id),
		).toEqual([created.entityId]);

		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: keyword.id,
				changes: { nameEn: "Pull 2" },
			},
			{ db: env.db },
		);
		env.api.deleteRow("keyword", keyword.id);
		await pull();
		const update = (await outbox()).find((item) => item.entity === "keyword");
		expect(update?.status).toBe("conflict");
		expect(update?.conflict?.kind).toBe("deleted");
		expect(update?.conflict?.server).toMatchObject({
			id: keyword.id,
			baseVersion: { categoryId: env.category.id },
		});
	});

	it("never let an older row overwrite a newer one", async () => {
		await upsertRows(env.db.keywordCategories, [
			{
				...env.category,
				nameEn: "New",
				updatedAt: "2031-01-01T00:00:00.000Z",
			} as never,
		]);
		await upsertRows(env.db.keywordCategories, [
			{
				...env.category,
				nameEn: "Old",
				updatedAt: "2020-01-01T00:00:00.000Z",
			} as never,
		]);
		expect((await env.db.keywordCategories.get(env.category.id))?.nameEn).toBe(
			"New",
		);
	});
});

describe("3.2.x cleanup", () => {
	it("deletes the old database and pool key without reading them, and retries after a failure", async () => {
		const old = new Dexie(OLD_DB_NAME);
		old.version(1).stores({ keywords: "id" });
		await old.open();
		await old.table("keywords").put({ id: "x" });
		old.close();
		await fakeBrowser.storage.local.set({
			[OLD_POOL_KEY]: { pendingOps: [1] },
		});
		resetOldStorageCleanupForTests();
		const originalRemove = fakeBrowser.storage.local.remove;
		fakeBrowser.storage.local.remove = async () => {
			throw new Error("blocked");
		};
		expect(await deleteOldStorage()).toBe(false);
		fakeBrowser.storage.local.remove = originalRemove;
		expect(await deleteOldStorage()).toBe(true);
		expect(fakeBrowser.storage.local.peek(OLD_POOL_KEY)).toBeUndefined();
		expect((await Dexie.getDatabaseNames()).includes(OLD_DB_NAME)).toBe(false);
		expect(await env.db.mutations.count()).toBe(0);
	});

	it("falls back when IndexedDB cannot be opened", async () => {
		const broken = new StoryLensDatabase("broken");
		broken.open = () => Promise.reject(new Error("blocked")) as ReturnType<typeof broken.open>;
		setOfflineDbForTests(broken);
		expect(await openOfflineDb()).toBeNull();
		expect(isOfflineUnavailable()).toBe(true);
		expect((await getNovelView(env.novel.id, env.user.id)).keywords).toEqual(
			[],
		);
		setOfflineDbForTests(env.db);
	});
});
