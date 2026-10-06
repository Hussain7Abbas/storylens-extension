/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { makeUser, setupEngine, signIn } from "../../helpers/engine";

const { enqueue, PermissionDenied, ValidationFailed } = await import(
	"../../../src/lib/offline/outbox"
);
const { getNovelView } = await import("../../../src/lib/offline/views");
const { runSync } = await import("../../../src/lib/offline/sync/runner");
const { pullNovel, pullLookups } = await import(
	"../../../src/lib/offline/sync/pull"
);

/**
 * Translation links: saving a keyword or alias with one merges the row holding
 * its other-language name into it. The projection mirrors the server's merge, so
 * the view is right before the push, and the push leaves no stale row behind.
 */

type Env = Awaited<ReturnType<typeof setupEngine>>;
let env: Env;
const token = "token-reader-1";

const pull = async () => {
	await pullLookups({ db: env.db, token });
	await pullNovel(env.novel.id, { db: env.db, token });
};
const run = () => runSync({ reason: "enqueue", db: env.db, pull: "none" });
const view = () => getNovelView(env.novel.id, env.user.id, env.db);
const outbox = () => env.db.mutations.toArray();

/** A keyword on the server, named in one language, created by `owner`. */
const seed = (names: { nameAr?: string; nameEn?: string }, owner?: string) =>
	env.api.seedKeyword(
		env.novel.id,
		{
			nameAr: null,
			nameEn: null,
			...names,
			categoryId: env.category.id,
			natureId: env.nature.id,
		},
		owner ?? env.user.id,
	);

const keywordIn = async (id: string) =>
	(await view()).keywords.find((keyword) => keyword.id === id);

beforeEach(async () => {
	env = await setupEngine();
});

describe("keyword translation links", () => {
	it("mirrors the merge in the view and leaves no absorbed row after the push", async () => {
		const target = seed({ nameAr: "ليو" });
		const source = seed({ nameEn: "Leo" });
		const movedAlias = env.api.seedAlias(source.id, {
			nameEn: "Little Leo",
			createdById: env.user.id,
		});
		await pull();

		const stored = await env.db.keywords.get(target.id);
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: target.id,
				changes: {},
				seenUpdatedAt: String(stored?.updatedAt),
				translationKeywordId: source.id,
			},
			{ db: env.db },
		);

		// Before the push, the local view already shows the merged keyword.
		const linked = await keywordIn(target.id);
		expect(linked).toMatchObject({ nameAr: "ليو", nameEn: "Leo" });
		expect(linked?.aliases.map((alias) => alias.id)).toEqual([movedAlias.id]);
		expect(await keywordIn(source.id)).toBeUndefined();

		await run();

		expect(await outbox()).toHaveLength(0);
		expect(await env.db.keywords.get(source.id)).toBeUndefined();
		expect(await env.db.keywords.get(target.id)).toMatchObject({
			nameAr: "ليو",
			nameEn: "Leo",
		});
		expect((await env.db.keywordAliases.get(movedAlias.id))?.keywordId).toBe(
			target.id,
		);
		expect((await view()).keywords).toHaveLength(1);
	});

	it("links while creating a keyword", async () => {
		const source = seed({ nameEn: "Leo" });
		await pull();

		const created = await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: {
					nameAr: "ليو",
					categoryId: env.category.id,
					natureId: env.nature.id,
				},
				translationKeywordId: source.id,
			},
			{ db: env.db },
		);

		expect(await keywordIn(created.entityId)).toMatchObject({
			nameAr: "ليو",
			nameEn: "Leo",
		});
		await run();
		expect(await outbox()).toHaveLength(0);
		expect(await env.db.keywords.get(source.id)).toBeUndefined();
		expect(await env.db.keywords.get(created.entityId)).toMatchObject({
			nameAr: "ليو",
			nameEn: "Leo",
		});
	});

	it("refuses itself, a second name in one language and a versioned keyword", async () => {
		const target = seed({ nameAr: "ليو" });
		const sameLanguage = seed({ nameAr: "أمل" });
		const versioned = seed({ nameEn: "Versioned" });
		env.api.seedVersion(versioned.id, {
			startingChapter: 5,
			categoryId: env.category.id,
			natureId: env.nature.id,
		});
		await pull();
		const stored = await env.db.keywords.get(target.id);
		const link = (translationKeywordId: string) =>
			enqueue(
				{
					entity: "keyword",
					op: "update",
					id: target.id,
					changes: {},
					seenUpdatedAt: String(stored?.updatedAt),
					translationKeywordId,
				},
				{ db: env.db },
			);

		await expect(link(target.id)).rejects.toThrow(ValidationFailed);
		await link(sameLanguage.id).then(
			() => expect.unreachable("the same language must be refused"),
			(error: { code?: string }) =>
				expect(error.code).toBe("TRANSLATION_SAME_LANGUAGE"),
		);
		await link(versioned.id).then(
			() => expect.unreachable("a versioned keyword must be refused"),
			(error: { code?: string }) =>
				expect(error.code).toBe("TRANSLATION_HAS_VERSIONS"),
		);
		expect(await outbox()).toHaveLength(0);
	});

	it("refuses absorbing a keyword the reader may not delete", async () => {
		const other = makeUser("reader-2");
		env.api.addUser(other.id);
		const target = seed({ nameAr: "ليو" });
		const theirs = seed({ nameEn: "Theirs" }, other.id);
		await pull();
		const stored = await env.db.keywords.get(target.id);

		await expect(
			enqueue(
				{
					entity: "keyword",
					op: "update",
					id: target.id,
					changes: {},
					seenUpdatedAt: String(stored?.updatedAt),
					translationKeywordId: theirs.id,
				},
				{ db: env.db },
			),
		).rejects.toThrow(PermissionDenied);
		expect(await outbox()).toHaveLength(0);
	});

	it("sends a link whose keyword another device deleted and keeps the change", async () => {
		const target = seed({ nameAr: "ليو" });
		const source = seed({ nameEn: "Leo" });
		await pull();
		const stored = await env.db.keywords.get(target.id);
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: target.id,
				changes: { matchingType: "PARTIAL" },
				seenUpdatedAt: String(stored?.updatedAt),
				translationKeywordId: source.id,
			},
			{ db: env.db },
		);
		// The keyword is gone on the server before the change is sent.
		env.api.deleteRow("keyword", source.id);

		await run();

		expect(await outbox()).toHaveLength(0);
		expect(await env.db.keywords.get(target.id)).toMatchObject({
			matchingType: "PARTIAL",
			nameEn: null,
		});
	});
});

describe("alias translation links", () => {
	it("merges a sibling alias in the view and after the push", async () => {
		const keyword = seed({ nameAr: "ليو", nameEn: "Leo" });
		const target = env.api.seedAlias(keyword.id, {
			nameAr: "الصغير",
			createdById: env.user.id,
		});
		const source = env.api.seedAlias(keyword.id, {
			nameEn: "Little one",
			createdById: env.user.id,
		});
		await pull();
		const stored = await env.db.keywordAliases.get(target.id);

		await enqueue(
			{
				entity: "keywordAlias",
				op: "update",
				id: target.id,
				changes: {},
				seenUpdatedAt: String(stored?.updatedAt),
				translationAliasId: source.id,
			},
			{ db: env.db },
		);

		const merged = (await keywordIn(keyword.id))?.aliases ?? [];
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({
			id: target.id,
			nameAr: "الصغير",
			nameEn: "Little one",
		});

		await run();

		expect(await outbox()).toHaveLength(0);
		expect(await env.db.keywordAliases.get(source.id)).toBeUndefined();
		expect(await env.db.keywordAliases.get(target.id)).toMatchObject({
			nameAr: "الصغير",
			nameEn: "Little one",
		});
	});

	it("refuses an alias of another keyword", async () => {
		const keyword = seed({ nameAr: "ليو" });
		const otherKeyword = seed({ nameEn: "Other" });
		const target = env.api.seedAlias(keyword.id, {
			nameAr: "الصغير",
			createdById: env.user.id,
		});
		const foreign = env.api.seedAlias(otherKeyword.id, {
			nameEn: "Foreign",
			createdById: env.user.id,
		});
		await pull();
		const stored = await env.db.keywordAliases.get(target.id);

		await enqueue(
			{
				entity: "keywordAlias",
				op: "update",
				id: target.id,
				changes: {},
				seenUpdatedAt: String(stored?.updatedAt),
				translationAliasId: foreign.id,
			},
			{ db: env.db },
		).then(
			() => expect.unreachable("another keyword's alias must be refused"),
			(error: { code?: string }) =>
				expect(error.code).toBe("TRANSLATION_OTHER_KEYWORD"),
		);
		expect(await outbox()).toHaveLength(0);
	});
});

describe("signed out", () => {
	it("refuses a link without a session", async () => {
		const target = seed({ nameAr: "ليو" });
		const source = seed({ nameEn: "Leo" });
		await pull();
		const stored = await env.db.keywords.get(target.id);
		await signIn(null);
		await expect(
			enqueue(
				{
					entity: "keyword",
					op: "update",
					id: target.id,
					changes: {},
					seenUpdatedAt: String(stored?.updatedAt),
					translationKeywordId: source.id,
				},
				{ db: env.db },
			),
		).rejects.toThrow();
	});
});

describe("a second translation link", () => {
	it("is refused once the row is named in both languages", async () => {
		const target = seed({ nameAr: "ليو" });
		const first = seed({ nameEn: "Leo" });
		const second = seed({ nameEn: "Leon" });
		await pull();
		const stored = await env.db.keywords.get(target.id);
		const link = (translationKeywordId: string) =>
			enqueue(
				{
					entity: "keyword",
					op: "update",
					id: target.id,
					changes: {},
					seenUpdatedAt: String(stored?.updatedAt),
					translationKeywordId,
				},
				{ db: env.db },
			);

		await link(first.id);
		// The first link already gave the keyword its English name.
		await link(second.id).then(
			() => expect.unreachable("a second English name must be refused"),
			(error: { code?: string }) =>
				expect(error.code).toBe("TRANSLATION_SAME_LANGUAGE"),
		);
		expect(await outbox()).toHaveLength(1);

		await run();
		expect(await env.db.keywords.get(first.id)).toBeUndefined();
		expect(await env.db.keywords.get(second.id)).toMatchObject({
			nameEn: "Leon",
		});
	});
});
