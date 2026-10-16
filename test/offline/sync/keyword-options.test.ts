/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { setupEngine } from "../../helpers/engine";

const { enqueue, ValidationFailed } = await import(
	"../../../src/lib/offline/outbox"
);
const { getNovelView, getLookupsView } = await import(
	"../../../src/lib/offline/views"
);
const { pullNovel, pullLookups } = await import(
	"../../../src/lib/offline/sync/pull"
);
const { runSync } = await import("../../../src/lib/offline/sync/runner");
let env: Awaited<ReturnType<typeof setupEngine>>;
const token = "token-reader-1";
const pull = async () => {
	await pullLookups({ db: env.db, token });
	await pullNovel(env.novel.id, { db: env.db, token });
};
const run = () => runSync({ reason: "enqueue", db: env.db, pull: "none" });
const view = () => getNovelView(env.novel.id, env.user.id, env.db);
const values = () => ({
	nameEn: "Mira",
	categoryId: env.category.id,
	natureId: env.nature.id,
});
beforeEach(async () => {
	env = await setupEngine({ moderator: true });
	await pull();
});

describe("initial chapter ranges through offline sync", () => {
	it("projects and syncs a bounded base, preserves its end, and refuses earlier versions", async () => {
		const created = await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: { ...values(), startingChapter: 12, endingChapter: 24 },
			},
			{ db: env.db },
		);
		expect((await view()).keywords[0]?.versions[0]).toMatchObject({
			startingChapter: 12,
			endingChapter: 24,
		});
		await expect(
			enqueue(
				{
					entity: "keywordVersion",
					op: "create",
					keywordId: created.entityId,
					values: { currentChapter: 10 },
				},
				{ db: env.db },
			),
		).rejects.toBeInstanceOf(ValidationFailed);
		await enqueue(
			{
				entity: "keywordVersion",
				op: "create",
				keywordId: created.entityId,
				values: { currentChapter: 30 },
			},
			{ db: env.db },
		);
		expect(
			(await view()).keywords[0]?.versions.map((v) => [
				v.startingChapter,
				v.endingChapter,
			]),
		).toEqual([
			[12, 24],
			[30, null],
		]);
		await run();
		expect(await env.db.mutations.count()).toBe(0);
		expect(env.api.versions.get(created.versionId as string)).toMatchObject({
			startingChapter: 12,
			endingChapter: 24,
		});
		await pull();
		expect(
			(await view()).keywords[0]?.versions.map((v) => [
				v.startingChapter,
				v.endingChapter,
			]),
		).toEqual([
			[12, 24],
			[30, null],
		]);
	});
	for (const range of [
		{ startingChapter: -1 },
		{ startingChapter: 1.5 },
		{ startingChapter: 8, endingChapter: 7 },
		{ endingChapter: -1 },
		{ endingChapter: 1.5 },
	]) {
		it(`rejects ${JSON.stringify(range)} before queuing`, async () => {
			await expect(
				enqueue(
					{
						entity: "keyword",
						op: "create",
						novelId: env.novel.id,
						values: { ...values(), ...range },
					},
					{ db: env.db },
				),
			).rejects.toBeInstanceOf(ValidationFailed);
			expect(await env.db.mutations.count()).toBe(0);
		});
	}
	it("keeps old payloads at zero with no ending chapter", async () => {
		await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: values(),
			},
			{ db: env.db },
		);
		expect((await view()).keywords[0]?.versions[0]).toMatchObject({
			startingChapter: 0,
			endingChapter: null,
		});
	});
});

describe("category effects through offline sync", () => {
	it("projects effects onto keywords and persists creates and later edits", async () => {
		const category = await enqueue(
			{
				entity: "keywordCategory",
				op: "create",
				values: { nameEn: "Magic", color: "#123456", effect: "SPARKLES" },
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: { ...values(), categoryId: category.entityId },
			},
			{ db: env.db },
		);
		expect((await view()).keywords[0]?.versions[0]?.category).toMatchObject({
			color: "#123456",
			effect: "SPARKLES",
		});
		await run();
		expect(await env.db.mutations.count()).toBe(0);
		expect(env.api.categories.get(category.entityId)?.effect).toBe("SPARKLES");
		await enqueue(
			{
				entity: "keywordCategory",
				op: "update",
				id: category.entityId,
				changes: { effect: "GLITCHING" },
			},
			{ db: env.db },
		);
		expect((await view()).keywords[0]?.versions[0]?.category?.effect).toBe(
			"GLITCHING",
		);
		await run();
		await pull();
		expect(
			(await getLookupsView(env.user.id, env.db)).categories.find(
				(c) => c.id === category.entityId,
			)?.effect,
		).toBe("GLITCHING");
	});
	it("defaults legacy creates to NONE", async () => {
		const category = await enqueue(
			{
				entity: "keywordCategory",
				op: "create",
				values: { nameEn: "Legacy", color: "#123456" },
			},
			{ db: env.db },
		);
		await run();
		expect(env.api.categories.get(category.entityId)?.effect).toBe("NONE");
	});
});
