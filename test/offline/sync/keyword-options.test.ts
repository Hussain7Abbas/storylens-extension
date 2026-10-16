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

describe("word VFX through offline sync", () => {
	it("keeps keyword and aliases independent across create, partial edit, pull and clearing", async () => {
		const parent = await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: { ...values(), wordVfx: "SPARKLES" },
			},
			{ db: env.db },
		);
		const child = await enqueue(
			{
				entity: "keywordAlias",
				op: "create",
				keywordId: parent.entityId,
				values: { nameEn: "The Sword", wordVfx: "HEAT" },
			},
			{ db: env.db },
		);
		const plain = await enqueue(
			{
				entity: "keywordAlias",
				op: "create",
				keywordId: parent.entityId,
				values: { nameEn: "Plain alias" },
			},
			{ db: env.db },
		);
		expect((await view()).keywords[0]).toMatchObject({ wordVfx: "SPARKLES" });
		expect(
			(await view()).keywords[0]?.aliases.find((a) => a.id === child.entityId)
				?.wordVfx,
		).toBe("HEAT");
		expect(
			(await view()).keywords[0]?.aliases.find((a) => a.id === plain.entityId)
				?.wordVfx,
		).toBe("NONE");
		await run();
		expect(await env.db.mutations.count()).toBe(0);
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: parent.entityId,
				changes: { wordVfx: "GLITCHING" },
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keywordAlias",
				op: "update",
				id: child.entityId,
				changes: { wordVfx: "NONE" },
			},
			{ db: env.db },
		);
		await run();
		await pull();
		expect((await view()).keywords[0]?.wordVfx).toBe("GLITCHING");
		expect(
			(await view()).keywords[0]?.aliases.find((a) => a.id === child.entityId)
				?.wordVfx,
		).toBe("NONE");
		expect(env.api.keywords.get(parent.entityId)?.wordVfx).toBe("GLITCHING");
		expect(env.api.aliases.get(child.entityId)?.wordVfx).toBe("NONE");
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: parent.entityId,
				changes: { matchingType: "PARTIAL" },
			},
			{ db: env.db },
		);
		await run();
		await pull();
		expect((await view()).keywords[0]?.wordVfx).toBe("GLITCHING");
	});
});

describe("word VFX colors through offline sync", () => {
	it("projects, syncs, preserves and clears independent nullable hex colors", async () => {
		const parent = await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: { ...values(), wordVfx: "SPARKLES", wordVfxColor: "#123456" },
			},
			{ db: env.db },
		);
		const alias = await enqueue(
			{
				entity: "keywordAlias",
				op: "create",
				keywordId: parent.entityId,
				values: { nameEn: "Sword", wordVfx: "HEAT", wordVfxColor: "#abcdef" },
			},
			{ db: env.db },
		);
		expect((await view()).keywords[0]?.wordVfxColor).toBe("#123456");
		expect((await view()).keywords[0]?.aliases[0]?.wordVfxColor).toBe(
			"#abcdef",
		);
		await run();
		await pull();
		expect(env.api.keywords.get(parent.entityId)?.wordVfxColor).toBe("#123456");
		expect(env.api.aliases.get(alias.entityId)?.wordVfxColor).toBe("#abcdef");
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: parent.entityId,
				changes: { matchingType: "PARTIAL" },
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keywordAlias",
				op: "update",
				id: alias.entityId,
				changes: { wordVfxColor: null },
			},
			{ db: env.db },
		);
		await run();
		await pull();
		expect((await view()).keywords[0]?.wordVfxColor).toBe("#123456");
		expect((await view()).keywords[0]?.aliases[0]?.wordVfxColor).toBeNull();
		await expect(
			enqueue(
				{
					entity: "keyword",
					op: "update",
					id: parent.entityId,
					changes: { wordVfxColor: "red" },
				},
				{ db: env.db },
			),
		).rejects.toBeInstanceOf(ValidationFailed);
		await expect(
			enqueue(
				{
					entity: "keywordAlias",
					op: "update",
					id: alias.entityId,
					changes: { wordVfxColor: "#123" },
				},
				{ db: env.db },
			),
		).rejects.toBeInstanceOf(ValidationFailed);
		expect(await env.db.mutations.count()).toBe(0);
	});
});
