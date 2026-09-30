/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import {
	makeUser,
	secondContext,
	setOnline,
	setupEngine,
	signIn,
} from "../../helpers/engine";
import { fakeBrowser } from "../../helpers/fake-browser";

const { enqueue } = await import("../../../src/lib/offline/outbox");
const { getNovelView } = await import("../../../src/lib/offline/views");
const { runSync, PERIODIC_ALARM, RETRY_ALARM, ensurePeriodicAlarm } =
	await import("../../../src/lib/offline/sync/runner");
const { pullNovel, pullLookups } = await import(
	"../../../src/lib/offline/sync/pull"
);
const { getMeta, setMeta } = await import("../../../src/lib/offline/meta");

type Env = Awaited<ReturnType<typeof setupEngine>>;
let env: Env;
const token = "token-reader-1";

const run = (options: Partial<Parameters<typeof runSync>[0]> = {}) =>
	runSync({ reason: "enqueue", db: env.db, pull: "none", ...options });
const outbox = async () =>
	(await env.db.mutations.toArray()).sort(
		(left, right) => (left.seq ?? 0) - (right.seq ?? 0),
	);
const writes = () =>
	env.api.requests.filter((request) => request.method !== "GET");
const keywordValues = (nameEn = "Mira") => ({
	nameEn,
	categoryId: env.category.id,
	natureId: env.nature.id,
});
const pull = async () => {
	await pullLookups({ db: env.db, token });
	await pullNovel(env.novel.id, { db: env.db, token });
};

beforeEach(async () => {
	env = await setupEngine();
	await pull();
	env.api.requests = [];
});

describe("sync runner", () => {
	it("sends an offline keyword, alias, version and base-version edit in order with client IDs", async () => {
		setOnline(false);
		const keyword = await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: keywordValues(),
			},
			{ db: env.db },
		);
		const alias = await enqueue(
			{
				entity: "keywordAlias",
				op: "create",
				keywordId: keyword.entityId,
				values: { nameEn: "Little Mira" },
			},
			{ db: env.db },
		);
		const version = await enqueue(
			{
				entity: "keywordVersion",
				op: "create",
				keywordId: keyword.entityId,
				values: { currentChapter: 5 },
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keywordVersion",
				op: "update",
				id: keyword.versionId as string,
				changes: { description: "edited" },
			},
			{ db: env.db },
		);
		expect((await run()).state).toBe("offline");
		expect(writes()).toEqual([]);
		setOnline(true);
		const summary = await run();
		expect(summary.sent).toBe(3);
		expect(
			writes().map((request) => `${request.method} ${request.path}`),
		).toEqual([
			"POST /keywords/",
			"POST /keyword-aliases/",
			"POST /keyword-versions/",
		]);
		expect(env.api.keywords.has(keyword.entityId)).toBe(true);
		expect(env.api.aliases.has(alias.entityId)).toBe(true);
		expect(env.api.versions.get(keyword.versionId as string)?.description).toBe(
			"edited",
		);
		expect(env.api.versions.has(version.entityId)).toBe(true);
		expect(await outbox()).toEqual([]);
		const local = (
			await getNovelView(env.novel.id, env.user.id, env.db)
		).keywords.find((item) => item.id === keyword.entityId);
		expect(
			local?.versions.map((row) => [
				Number(row.startingChapter),
				row.endingChapter,
			]),
		).toEqual([
			[0, 4],
			[5, null],
		]);
	});

	it("replays a create whose response was lost; one row on the server", async () => {
		const keyword = await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: keywordValues(),
			},
			{ db: env.db },
		);
		env.api.failNext({ kind: "lostResponse" }, (method) => method === "POST");
		await run();
		expect((await outbox()).length).toBe(1);
		await env.db.mutations.toCollection().modify({ nextAttemptAt: 0 });
		await run();
		expect(await outbox()).toEqual([]);
		expect(
			[...env.api.keywords.values()].filter(
				(row) => row.id === keyword.entityId,
			).length,
		).toBe(1);
	});

	it("drops a replayed update whose fields the server already has", async () => {
		const server = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Ann", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		await pull();
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: server.id,
				changes: { nameEn: "Ann 2" },
			},
			{ db: env.db },
		);
		env.api.failNext({ kind: "lostResponse" }, (method) => method === "PUT");
		await run();
		await env.db.mutations.toCollection().modify({ nextAttemptAt: 0 });
		const summary = await run();
		expect(summary.merged).toBe(1);
		expect(await outbox()).toEqual([]);
		expect(env.api.keywords.get(server.id)?.nameEn).toBe("Ann 2");
	});

	it("resends a mutation leased by a worker that died", async () => {
		await enqueue(
			{
				entity: "replacement",
				op: "create",
				novelId: env.novel.id,
				values: { from: "a", to: "b" },
			},
			{ db: env.db },
		);
		await env.db.mutations
			.toCollection()
			.modify({ status: "inflight", leaseUntil: Date.now() - 1 });
		await run();
		expect(await outbox()).toEqual([]);
		expect(env.api.replacements.size).toBe(1);
	});

	it("merges a remote edit of another field automatically", async () => {
		const server = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Bo", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		await pull();
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: server.id,
				changes: { nameEn: "Bo 2" },
			},
			{ db: env.db },
		);
		env.api.editRow(
			env.api.keywords,
			server.id,
			{ matchingType: "PARTIAL" },
			"keyword",
		);
		await run();
		expect(await outbox()).toEqual([]);
		expect(env.api.keywords.get(server.id)).toMatchObject({
			nameEn: "Bo 2",
			matchingType: "PARTIAL",
		});
	});

	it("turns a remote edit of the same field into a conflict and keeps sending other entities", async () => {
		const server = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Cy", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		await pull();
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: server.id,
				changes: { nameEn: "Cy mine" },
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "replacement",
				op: "create",
				novelId: env.novel.id,
				values: { from: "x", to: "y" },
			},
			{ db: env.db },
		);
		env.api.editRow(
			env.api.keywords,
			server.id,
			{ nameEn: "Cy theirs" },
			"keyword",
		);
		await run();
		let queued = await outbox();
		expect(queued.length).toBe(1);
		expect(queued[0]?.status).toBe("conflict");
		expect(queued[0]?.conflict?.fields?.map((field) => field.field)).toEqual([
			"nameEn",
		]);
		expect(env.api.replacements.size).toBe(1);
		// A later change of the same keyword waits behind the conflict.
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: server.id,
				changes: { matchingType: "PARTIAL" },
			},
			{ db: env.db },
		);
		await run();
		queued = await outbox();
		expect(queued.map((row) => row.status)).toEqual(["conflict", "pending"]);
		expect(env.api.keywords.get(server.id)?.matchingType).toBe("FULL");
		const local = (
			await getNovelView(env.novel.id, env.user.id, env.db)
		).keywords.find((item) => item.id === server.id);
		expect(local?.nameEn).toBe("Cy mine");
	});

	it("maps remote deletes, duplicates, missing parents and permissions", async () => {
		const deleted = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Gone", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		const parent = env.api.seedKeyword(
			env.novel.id,
			{
				nameEn: "Parent",
				categoryId: env.category.id,
				natureId: env.nature.id,
			},
			env.user.id,
		);
		const theirs = env.api.seedKeyword(
			env.novel.id,
			{
				nameEn: "Theirs",
				categoryId: env.category.id,
				natureId: env.nature.id,
			},
			env.user.id,
		);
		await pull();
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: deleted.id,
				changes: { nameEn: "Gone 2" },
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: keywordValues("Dup"),
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keywordAlias",
				op: "create",
				keywordId: parent.id,
				values: { nameEn: "Orphan" },
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: theirs.id,
				changes: { nameEn: "Theirs 2" },
			},
			{ db: env.db },
		);
		env.api.deleteRow("keyword", deleted.id);
		env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Dup", categoryId: env.category.id, natureId: env.nature.id },
			"other-device",
		);
		env.api.deleteRow("keyword", parent.id);
		env.api.keywords.set(theirs.id, {
			...(env.api.keywords.get(theirs.id) as { id: string }),
			createdById: "someone-else",
		});
		await run();
		const kinds = (await outbox()).map((item) => [
			item.status,
			item.conflict?.kind,
		]);
		expect(kinds).toEqual([
			["conflict", "deleted"],
			["conflict", "duplicate"],
			["conflict", "parent-missing"],
			["rejected", "permission"],
		]);
		expect(await env.db.keywords.get(deleted.id)).toBeUndefined();
	});

	it("lets a local delete win and treats an already deleted row as done", async () => {
		const edited = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Del", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		const gone = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Gone", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		await pull();
		await enqueue(
			{ entity: "keyword", op: "delete", id: edited.id },
			{ db: env.db },
		);
		await enqueue(
			{ entity: "keyword", op: "delete", id: gone.id },
			{ db: env.db },
		);
		env.api.editRow(
			env.api.keywords,
			edited.id,
			{ nameEn: "Del edited" },
			"keyword",
		);
		env.api.deleteRow("keyword", gone.id);
		await run();
		expect(await outbox()).toEqual([]);
		expect(env.api.keywords.has(edited.id)).toBe(false);
	});

	it("pauses on 401 and 426 without counting attempts, and resumes", async () => {
		await enqueue(
			{
				entity: "replacement",
				op: "create",
				novelId: env.novel.id,
				values: { from: "a", to: "b" },
			},
			{ db: env.db },
		);
		env.api.failNext(
			{ kind: "status", status: 401 },
			(method) => method === "POST",
		);
		expect((await run()).state).toBe("authRequired");
		expect((await outbox())[0]?.attempts).toBe(0);
		env.api.failNext(
			{ kind: "status", status: 426 },
			(method) => method === "POST",
		);
		expect((await run()).state).toBe("upgradeRequired");
		expect((await outbox())[0]).toMatchObject({
			attempts: 0,
			status: "pending",
		});
		await run();
		expect(await outbox()).toEqual([]);
	});

	it("backs off on 5xx and honours Retry-After, never exhausting", async () => {
		await enqueue(
			{
				entity: "replacement",
				op: "create",
				novelId: env.novel.id,
				values: { from: "a", to: "b" },
			},
			{ db: env.db },
		);
		const delays: number[] = [];
		for (let attempt = 1; attempt <= 3; attempt++) {
			env.api.failNext(
				{ kind: "status", status: 503 },
				(method) => method === "POST",
			);
			const before = Date.now();
			await run();
			const [row] = await outbox();
			expect(row?.attempts).toBe(attempt);
			delays.push((row?.nextAttemptAt ?? 0) - before);
			await env.db.mutations.toCollection().modify({ nextAttemptAt: 0 });
		}
		expect(delays[0]).toBeGreaterThanOrEqual(4000);
		expect(delays[2]).toBeGreaterThan(delays[0] as number);
		env.api.failNext(
			{ kind: "status", status: 429, retryAfter: 120 },
			(method) => method === "POST",
		);
		const before = Date.now();
		await run();
		expect(
			((await outbox())[0]?.nextAttemptAt ?? 0) - before,
		).toBeGreaterThanOrEqual(119_000);
		await env.db.mutations.toCollection().modify({ nextAttemptAt: 0 });
		await run();
		expect(await outbox()).toEqual([]);
	});

	it("stops at the first network failure and schedules the retry alarm", async () => {
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
				values: { from: "c", to: "d" },
			},
			{ db: env.db },
		);
		env.api.failNext({ kind: "network" }, (method) => method === "POST");
		expect((await run()).state).toBe("offline");
		expect(writes().length).toBe(1);
		const alarm = await fakeBrowser.alarms.get(RETRY_ALARM);
		const [row] = await outbox();
		expect(alarm?.scheduledTime).toBeGreaterThanOrEqual(
			row?.nextAttemptAt as number,
		);
	});

	it("never attempts children of a keyword whose create failed", async () => {
		const keyword = await enqueue(
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
				keywordId: keyword.entityId,
				values: { nameEn: "Child" },
			},
			{ db: env.db },
		);
		env.api.failNext(
			{ kind: "status", status: 500 },
			(method, path) => method === "POST" && path === "/keywords/",
			3,
		);
		await run();
		const [, alias] = await outbox();
		expect(alias?.attempts).toBe(0);
		expect(writes().every((request) => request.path === "/keywords/")).toBe(
			true,
		);
	});

	it("keeps accounts apart", async () => {
		await enqueue(
			{
				entity: "replacement",
				op: "create",
				novelId: env.novel.id,
				values: { from: "a", to: "b" },
			},
			{ db: env.db },
		);
		const other = makeUser("reader-2");
		env.api.addUser(other.id);
		await signIn(other);
		await enqueue(
			{
				entity: "replacement",
				op: "create",
				novelId: env.novel.id,
				values: { from: "c", to: "d" },
			},
			{ db: env.db },
		);
		expect(
			(await getNovelView(env.novel.id, other.id, env.db)).replacements.map(
				(row) => row.from,
			),
		).toEqual(["c"]);
		await run();
		expect(
			[...env.api.replacements.values()].map((row) => [
				row.from,
				row.createdById,
			]),
		).toEqual([["c", "reader-2"]]);
		await signIn(env.user);
		await run();
		expect(
			[...env.api.replacements.values()].map((row) => row.createdById).sort(),
		).toEqual(["reader-1", "reader-2"]);
		expect(await outbox()).toEqual([]);
	});

	it("sends nothing to an old API and everything once it updates", async () => {
		await enqueue(
			{
				entity: "replacement",
				op: "create",
				novelId: env.novel.id,
				values: { from: "a", to: "b" },
			},
			{ db: env.db },
		);
		env.api.oldApi = true;
		expect((await run()).state).toBe("apiOutdated");
		expect(writes()).toEqual([]);
		env.api.oldApi = false;
		await setMeta("protocol", { version: null, checkedAt: 0 }, env.db);
		await run();
		expect(await outbox()).toEqual([]);
	});

	it("rebases a second update enqueued while the first was in flight", async () => {
		const server = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Reb", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		await pull();
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: server.id,
				changes: { nameEn: "Reb 2" },
			},
			{ db: env.db },
		);
		const [first] = await outbox();
		await env.db.mutations.update(first?.seq as number, {
			status: "inflight",
			leaseUntil: Date.now() + 60_000,
		});
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: server.id,
				changes: { matchingType: "PARTIAL" },
			},
			{ db: env.db },
		);
		await env.db.mutations.update(first?.seq as number, {
			status: "pending",
			leaseUntil: undefined,
		});
		await run();
		expect(await outbox()).toEqual([]);
		expect(
			env.api.requests.filter((request) => request.method === "PUT").length,
		).toBe(2);
	});

	it("collapses concurrent kicks into one run and one rerun, with no duplicate sends", async () => {
		await enqueue(
			{
				entity: "replacement",
				op: "create",
				novelId: env.novel.id,
				values: { from: "a", to: "b" },
			},
			{ db: env.db },
		);
		const summaries = await Promise.all(Array.from({ length: 5 }, () => run()));
		expect(summaries.filter((summary) => summary.ran).length).toBe(1);
		expect(writes().length).toBe(1);
		expect(await getMeta("rerun", env.db)).toBe(false);
	});

	it("sends changes made from another context during a run", async () => {
		const popup = await secondContext();
		await enqueue(
			{
				entity: "replacement",
				op: "create",
				novelId: env.novel.id,
				values: { from: "a", to: "b" },
			},
			{ db: env.db },
		);
		env.api.failNext({ kind: "status", status: 500 }, () => false);
		const running = run();
		await enqueue(
			{
				entity: "replacement",
				op: "create",
				novelId: env.novel.id,
				values: { from: "c", to: "d" },
			},
			{ db: popup },
		);
		await running;
		await run();
		expect(env.api.replacements.size).toBe(2);
	});

	it("sends waiting changes at once on Sync now but leaves rejected ones", async () => {
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
				values: { from: "c", to: "d" },
			},
			{ db: env.db },
		);
		const [waiting, rejected] = await outbox();
		await env.db.mutations.update(waiting?.seq as number, {
			nextAttemptAt: Date.now() + 600_000,
		});
		await env.db.mutations.update(rejected?.seq as number, {
			status: "rejected",
		});
		const summary = await run({ manual: true, reason: "manual" });
		expect(summary.sent).toBe(1);
		expect((await outbox()).map((row) => row.status)).toEqual(["rejected"]);
	});

	it("stops at the deadline and continues in order next time", async () => {
		for (let index = 0; index < 20; index++) {
			await enqueue(
				{
					entity: "replacement",
					op: "create",
					novelId: env.novel.id,
					values: { from: `f${index}`, to: `t${index}` },
				},
				{ db: env.db },
			);
		}
		let clock = Date.now();
		const now = () => {
			clock += 1000;
			return clock;
		};
		await run({ now, deadlineMs: 5_000 });
		const sentFirst = env.api.replacements.size;
		expect(sentFirst).toBeGreaterThan(0);
		expect(sentFirst).toBeLessThan(20);
		await run();
		expect(env.api.replacements.size).toBe(20);
		const froms = writes().map(
			(request) => (request.body as { from: string }).from,
		);
		expect(froms).toEqual(
			Array.from({ length: 20 }, (_, index) => `f${index}`),
		);
	});

	it("creates the periodic alarm only when missing and clears the retry alarm when idle", async () => {
		await ensurePeriodicAlarm();
		await ensurePeriodicAlarm();
		expect(
			fakeBrowser.alarms.created.filter(
				(alarm) => alarm.name === PERIODIC_ALARM,
			).length,
		).toBe(1);
		await fakeBrowser.alarms.create(RETRY_ALARM, { when: Date.now() + 1000 });
		await run();
		expect(await fakeBrowser.alarms.get(RETRY_ALARM)).toBeUndefined();
	});
});
