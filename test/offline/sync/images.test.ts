/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { setOnline, setupEngine } from "../../helpers/engine";

const { enqueue, discardMutation, sweepOrphanFiles, ValidationFailed } =
	await import("../../../src/lib/offline/outbox");
const { runSync } = await import("../../../src/lib/offline/sync/runner");
const { pullNovel, pullLookups } = await import(
	"../../../src/lib/offline/sync/pull"
);

type Env = Awaited<ReturnType<typeof setupEngine>>;
let env: Env;
const image = (bytes = 8) => ({
	blob: new Blob([new Uint8Array(bytes)], { type: "image/png" }),
	name: "a.png",
	type: "image/png",
});
const run = () => runSync({ reason: "enqueue", db: env.db, pull: "none" });

beforeEach(async () => {
	env = await setupEngine();
	await pullLookups({ db: env.db, token: "token-reader-1" });
	await pullNovel(env.novel.id, { db: env.db, token: "token-reader-1" });
});

describe("offline images", () => {
	it("uploads first, then creates the keyword with the uploaded ID, and removes the blob", async () => {
		setOnline(false);
		const keyword = await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: {
					nameEn: "Pic",
					categoryId: env.category.id,
					natureId: env.nature.id,
				},
				image: image(),
			},
			{ db: env.db },
		);
		expect(await env.db.files.count()).toBe(1);
		setOnline(true);
		await run();
		const order = env.api.requests
			.filter((request) => request.method === "POST")
			.map((request) => request.path);
		expect(order).toEqual(["/files/upload", "/keywords/"]);
		const [file] = [...env.api.files.values()];
		expect(env.api.versions.get(keyword.versionId as string)?.imageId).toBe(
			file?.id,
		);
		expect(await env.db.files.count()).toBe(0);
		expect(await env.db.mutations.count()).toBe(0);
	});

	it("replays a lost upload without uploading twice", async () => {
		await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: {
					nameEn: "Pic",
					categoryId: env.category.id,
					natureId: env.nature.id,
				},
				image: image(),
			},
			{ db: env.db },
		);
		env.api.failNext(
			{ kind: "lostResponse" },
			(_method, path) => path === "/files/upload",
		);
		await run();
		await env.db.mutations.toCollection().modify({ nextAttemptAt: 0 });
		await run();
		expect(env.api.uploads).toBe(1);
		expect(await env.db.mutations.count()).toBe(0);
	});

	it("uploads only the last of several replaced images", async () => {
		const keyword = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "K", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		await pullNovel(env.novel.id, { db: env.db, token: "token-reader-1" });
		const base = [...env.api.versions.values()].find(
			(version) => version.keywordId === keyword.id,
		);
		setOnline(false);
		for (let index = 0; index < 3; index++) {
			await enqueue(
				{
					entity: "keywordVersion",
					op: "update",
					id: base?.id as string,
					changes: {},
					image: image(index + 1),
				},
				{ db: env.db },
			);
		}
		expect(await env.db.files.count()).toBe(1);
		setOnline(true);
		await run();
		expect(env.api.uploads).toBe(1);
	});

	it("drops the upload and blob when its keyword change is discarded", async () => {
		const keyword = await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: {
					nameEn: "Pic",
					categoryId: env.category.id,
					natureId: env.nature.id,
				},
				image: image(),
			},
			{ db: env.db },
		);
		await discardMutation(keyword.mutationId as string, { db: env.db });
		expect(await env.db.files.count()).toBe(0);
		expect(await env.db.mutations.count()).toBe(0);
	});

	it("refuses images over 10 MB before writing", async () => {
		const error = await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: {
					nameEn: "Big",
					categoryId: env.category.id,
					natureId: env.nature.id,
				},
				image: image(12 * 1024 * 1024),
			},
			{ db: env.db },
		).catch((caught) => caught);
		expect(error).toBeInstanceOf(ValidationFailed);
		expect(await env.db.mutations.count()).toBe(0);
	});

	it("sweeps orphan blobs at startup", async () => {
		await env.db.files.put({
			id: "orphan",
			mutationId: "gone",
			blob: new Blob(["x"]),
			name: "x",
			type: "image/png",
			size: 1,
			createdAt: 0,
		});
		expect(await sweepOrphanFiles(env.db)).toBe(1);
		expect(await env.db.files.count()).toBe(0);
	});
});
