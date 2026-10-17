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

describe("word main theme colors through offline sync", () => {
	it("projects, syncs, preserves and clears independent nullable hex colors", async () => {
		const parent = await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: { ...values(), wordVfx: "SPARKLES", mainThemeColor: "#123456" },
			},
			{ db: env.db },
		);
		const alias = await enqueue(
			{
				entity: "keywordAlias",
				op: "create",
				keywordId: parent.entityId,
				values: { nameEn: "Sword", wordVfx: "HEAT", mainThemeColor: "#abcdef" },
			},
			{ db: env.db },
		);
		expect((await view()).keywords[0]?.mainThemeColor).toBe("#123456");
		expect((await view()).keywords[0]?.aliases[0]?.mainThemeColor).toBe(
			"#abcdef",
		);
		await run();
		await pull();
		expect(env.api.keywords.get(parent.entityId)?.mainThemeColor).toBe(
			"#123456",
		);
		expect(env.api.aliases.get(alias.entityId)?.mainThemeColor).toBe("#abcdef");
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
				changes: { mainThemeColor: null },
			},
			{ db: env.db },
		);
		await run();
		await pull();
		expect((await view()).keywords[0]?.mainThemeColor).toBe("#123456");
		expect((await view()).keywords[0]?.aliases[0]?.mainThemeColor).toBeNull();
		await expect(
			enqueue(
				{
					entity: "keyword",
					op: "update",
					id: parent.entityId,
					changes: { mainThemeColor: "red" },
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
					changes: { mainThemeColor: "#123" },
				},
				{ db: env.db },
			),
		).rejects.toBeInstanceOf(ValidationFailed);
		expect(await env.db.mutations.count()).toBe(0);
	});
});

describe("category Word VFX and tint through offline sync", () => {
	it("saves, edits, pulls and clears category effects without dropping the tint", async () => {
		const created = await enqueue(
			{
				entity: "keywordCategory",
				op: "create",
				values: {
					nameEn: "Category VFX",
					color: "#123456",
					wordVfx: "HEAT",
					wordVfxColor: "#abcdef",
				},
			},
			{ db: env.db },
		);
		expect(
			(await getLookupsView(env.user.id, env.db)).categories.find(
				(row) => row.id === created.entityId,
			),
		).toMatchObject({ wordVfx: "HEAT", wordVfxColor: "#abcdef" });
		await run();
		await pull();
		expect(env.api.categories.get(created.entityId)).toMatchObject({
			wordVfx: "HEAT",
			wordVfxColor: "#abcdef",
		});
		await enqueue(
			{
				entity: "keywordCategory",
				op: "update",
				id: created.entityId,
				changes: { wordVfx: "SPARKLES" },
			},
			{ db: env.db },
		);
		await run();
		await pull();
		expect(
			(await getLookupsView(env.user.id, env.db)).categories.find(
				(row) => row.id === created.entityId,
			),
		).toMatchObject({ wordVfx: "SPARKLES", wordVfxColor: "#abcdef" });
		await enqueue(
			{
				entity: "keywordCategory",
				op: "update",
				id: created.entityId,
				changes: { wordVfx: "NONE", wordVfxColor: null },
			},
			{ db: env.db },
		);
		await run();
		await pull();
		expect(env.api.categories.get(created.entityId)).toMatchObject({
			wordVfx: "NONE",
			wordVfxColor: null,
		});
	});
	it("rejects an invalid category tint before queueing", async () => {
		await expect(
			enqueue(
				{
					entity: "keywordCategory",
					op: "create",
					values: {
						nameEn: "Bad tint",
						color: "#123456",
						wordVfx: "HEAT",
						wordVfxColor: "#abc",
					},
				},
				{ db: env.db },
			),
		).rejects.toBeInstanceOf(ValidationFailed);
		expect(await env.db.mutations.count()).toBe(0);
	});
});

describe("Glare through offline sync", () => {
	it("persists keyword, alias and category Glare across queued writes and pulls", async () => {
		const parent = await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: { ...values(), wordVfx: "GLARE" },
			},
			{ db: env.db },
		);
		const alias = await enqueue(
			{
				entity: "keywordAlias",
				op: "create",
				keywordId: parent.entityId,
				values: { nameEn: "Glowing Sword", wordVfx: "GLARE" },
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keywordCategory",
				op: "update",
				id: env.category.id,
				changes: { wordVfx: "GLARE" },
			},
			{ db: env.db },
		);
		await run();
		await pull();
		expect(
			(await view()).keywords.find((row) => row.id === parent.entityId),
		).toMatchObject({ wordVfx: "GLARE" });
		expect(
			(await view()).keywords
				.flatMap((row) => row.aliases)
				.find((row) => row.id === alias.entityId),
		).toMatchObject({ wordVfx: "GLARE" });
		expect(
			(await getLookupsView(env.user.id, env.db)).categories.find(
				(row) => row.id === env.category.id,
			),
		).toMatchObject({ wordVfx: "GLARE" });
	});
});

describe("lookup deletion with replacement", () => {
	for (const kind of ["keywordCategory", "keywordNature"] as const) {
		const field = kind === "keywordCategory" ? "categoryId" : "natureId";
		const source = () =>
			kind === "keywordCategory" ? env.category : env.nature;
		const destination = async () => {
			const target = env.api.seedLookup(
				kind === "keywordCategory" ? "category" : "nature",
				{ nameEn: "Destination" },
			);
			await pullLookups({ db: env.db, token });
			return target;
		};
		it(`projects and syncs ${kind} migration for cached and server-only links`, async () => {
			const target = await destination();
			const parent = env.api.seedKeyword(
				env.novel.id,
				{
					nameEn: "Existing",
					categoryId: env.category.id,
					natureId: env.nature.id,
				},
				env.user.id,
			);
			const alias = env.api.seedAlias(parent.id, {
				nameEn: "Alias",
				categoryId: env.category.id,
				natureId: env.nature.id,
			});
			await pull();
			const hiddenNovel = env.api.seedNovel({ nameEn: "Not downloaded" });
			const hidden = env.api.seedKeyword(
				hiddenNovel.id,
				{
					nameEn: "Hidden",
					categoryId: env.category.id,
					natureId: env.nature.id,
				},
				env.user.id,
			);
			const result = await enqueue(
				{
					entity: kind,
					op: "delete",
					id: source().id,
					replacementId: target.id,
				},
				{ db: env.db },
			);
			expect((await view()).keywords[0]?.versions[0]?.[field]).toBe(target.id);
			expect((await view()).keywords[0]?.aliases[0]?.[field]).toBe(target.id);
			expect(
				(await getLookupsView(env.user.id, env.db))[
					kind === "keywordCategory" ? "categories" : "natures"
				].some((row) => row.id === source().id),
			).toBe(false);
			expect(
				(await env.db.mutations.toArray()).find(
					(row) => row.id === result.mutationId,
				)?.patch.replacementId,
			).toBe(target.id);
			await run();
			expect(await env.db.mutations.count()).toBe(0);
			expect((await view()).keywords[0]?.versions[0]?.[field]).toBe(target.id);
			expect(env.api.aliases.get(alias.id)?.[field]).toBe(target.id);
			expect(
				[...env.api.versions.values()].find(
					(row) => row.keywordId === hidden.id,
				)?.[field],
			).toBe(target.id);
			await pull();
			expect((await view()).keywords[0]?.versions[0]?.[field]).toBe(target.id);
		});
		it(`keeps words created under an unsent ${kind} when moving and deleting it`, async () => {
			const draft = await enqueue(
				{
					entity: kind,
					op: "create",
					values: { nameEn: "Draft lookup", color: "#123456" },
				},
				{ db: env.db },
			);
			const parent = await enqueue(
				{
					entity: "keyword",
					op: "create",
					novelId: env.novel.id,
					values: { ...values(), [field]: draft.entityId },
				},
				{ db: env.db },
			);
			await enqueue(
				{
					entity: kind,
					op: "delete",
					id: draft.entityId,
					replacementId: source().id,
				},
				{ db: env.db },
			);
			expect(
				(await view()).keywords.find((row) => row.id === parent.entityId)
					?.versions[0]?.[field],
			).toBe(source().id);
			await run();
			expect(env.api.keywords.has(parent.entityId)).toBe(true);
			expect(
				[...env.api.versions.values()].find(
					(row) => row.keywordId === parent.entityId,
				)?.[field],
			).toBe(source().id);
		});
		it(`waits for a queued replacement and preserves migration when an earlier edit becomes a delete`, async () => {
			const target = await enqueue(
				{
					entity: kind,
					op: "create",
					values: { nameEn: "New replacement", color: "#abcdef" },
				},
				{ db: env.db },
			);
			await enqueue(
				{
					entity: kind,
					op: "update",
					id: source().id,
					changes: { color: "#123456" },
				},
				{ db: env.db },
			);
			await enqueue(
				{
					entity: kind,
					op: "delete",
					id: source().id,
					replacementId: target.entityId,
				},
				{ db: env.db },
			);
			await run();
			expect(await env.db.mutations.count()).toBe(0);
			const table =
				kind === "keywordCategory" ? env.api.categories : env.api.natures;
			expect(table.has(target.entityId)).toBe(true);
			expect(table.has(source().id)).toBe(false);
		});
		it(`rejects a same or absent replacement for ${kind}`, async () => {
			for (const replacementId of [source().id, crypto.randomUUID()])
				await expect(
					enqueue(
						{ entity: kind, op: "delete", id: source().id, replacementId },
						{ db: env.db },
					),
				).rejects.toBeInstanceOf(ValidationFailed);
		});
	}
	it("preserves the category swap through create, edit, sync and pull", async () => {
		const created = await enqueue(
			{
				entity: "keywordCategory",
				op: "create",
				values: {
					nameEn: "Swapped",
					color: "#123456",
					switchPositionWithNature: true,
				},
			},
			{ db: env.db },
		);
		await run();
		await pull();
		expect(
			(await getLookupsView(env.user.id, env.db)).categories.find(
				(row) => row.id === created.entityId,
			)?.switchPositionWithNature,
		).toBe(true);
		await enqueue(
			{
				entity: "keywordCategory",
				op: "update",
				id: created.entityId,
				changes: { switchPositionWithNature: false },
			},
			{ db: env.db },
		);
		await run();
		await pull();
		expect(
			env.api.categories.get(created.entityId)?.switchPositionWithNature,
		).toBe(false);
	});
});

it("retains and rewrites a backed-off word create when its category migration commits first", async () => {
	const target = env.api.seedLookup("category", { nameEn: "Destination" });
	await pullLookups({ db: env.db, token });
	const word = await enqueue(
		{
			entity: "keyword",
			op: "create",
			novelId: env.novel.id,
			values: values(),
		},
		{ db: env.db },
	);
	await enqueue(
		{
			entity: "keywordCategory",
			op: "delete",
			id: env.category.id,
			replacementId: target.id,
		},
		{ db: env.db },
	);
	env.api.failNext(
		{ kind: "status", status: 500 },
		(method) => method === "POST",
	);
	await run();
	const waiting = await env.db.mutations.toArray();
	expect(waiting).toHaveLength(1);
	expect(waiting[0]?.patch.categoryId).toBe(target.id);
	await runSync({ reason: "manual", manual: true, db: env.db, pull: "none" });
	expect(await env.db.mutations.count()).toBe(0);
	expect(
		[...env.api.versions.values()].find(
			(row) => row.keywordId === word.entityId,
		)?.categoryId,
	).toBe(target.id);
});

it("discarding an unsent lookup migration restores projected links", async () => {
	const target = env.api.seedLookup("category", { nameEn: "Destination" });
	env.api.seedKeyword(
		env.novel.id,
		{
			nameEn: "Original",
			categoryId: env.category.id,
			natureId: env.nature.id,
		},
		env.user.id,
	);
	await pull();
	const deletion = await enqueue(
		{
			entity: "keywordCategory",
			op: "delete",
			id: env.category.id,
			replacementId: target.id,
		},
		{ db: env.db },
	);
	expect((await view()).keywords[0]?.versions[0]?.categoryId).toBe(target.id);
	const { discardMutation } = await import("../../../src/lib/offline/outbox");
	await discardMutation(deletion.mutationId as string, { db: env.db });
	expect((await view()).keywords[0]?.versions[0]?.categoryId).toBe(
		env.category.id,
	);
	expect(env.api.categories.has(env.category.id)).toBe(true);
});
