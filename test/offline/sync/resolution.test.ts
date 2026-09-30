/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import {
	makeUser,
	secondContext,
	setupEngine,
	signIn,
} from "../../helpers/engine";

const { enqueue, applyResolution, discardMutation } = await import(
	"../../../src/lib/offline/outbox"
);
const { getNovelView } = await import("../../../src/lib/offline/views");
const { runSync } = await import("../../../src/lib/offline/sync/runner");
const { pullNovel, pullLookups, pullCatalogue, refreshNovel, pullDueUnits } =
	await import("../../../src/lib/offline/sync/pull");
const { pinNovel } = await import("../../../src/lib/offline/meta");

type Env = Awaited<ReturnType<typeof setupEngine>>;
let env: Env;
const token = "token-reader-1";
const run = () => runSync({ reason: "enqueue", db: env.db, pull: "none" });
const outbox = async () =>
	(await env.db.mutations.toArray()).sort(
		(left, right) => (left.seq ?? 0) - (right.seq ?? 0),
	);
const pull = async () => {
	await pullLookups({ db: env.db, token });
	await pullNovel(env.novel.id, { db: env.db, token });
};
const values = (nameEn: string) => ({
	nameEn,
	categoryId: env.category.id,
	natureId: env.nature.id,
});

/** The novel's keywords as comparable rows (children sorted), local view vs server. */
function shape(
	keywords: {
		id: string;
		nameEn: unknown;
		matchingType: unknown;
		aliases: { id: string; nameEn: unknown }[];
		versions: {
			id: string;
			startingChapter: unknown;
			endingChapter: unknown;
			description: unknown;
		}[];
	}[],
) {
	return keywords
		.map((keyword) => ({
			id: keyword.id,
			nameEn: keyword.nameEn,
			matchingType: keyword.matchingType,
			aliases: keyword.aliases.map((alias) => [alias.id, alias.nameEn]).sort(),
			versions: keyword.versions
				.map((version) => [
					version.id,
					Number(version.startingChapter),
					version.endingChapter === null ? null : Number(version.endingChapter),
					version.description,
				])
				.sort(),
		}))
		.sort((left, right) => left.id.localeCompare(right.id));
}

beforeEach(async () => {
	env = await setupEngine();
	await pull();
});

describe("the view predicts the server (phase 3 test 1)", () => {
	it("shows before sync exactly what the server holds after sync and a pull", async () => {
		const hub = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Hub", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		await pull();
		const created = await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: values("New"),
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keywordAlias",
				op: "create",
				keywordId: created.entityId,
				values: { nameEn: "New alias" },
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keywordVersion",
				op: "create",
				keywordId: hub.id,
				values: { currentChapter: 7, description: "later" },
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: hub.id,
				changes: { matchingType: "PARTIAL" },
			},
			{ db: env.db },
		);
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
		const predicted = await getNovelView(env.novel.id, env.user.id, env.db);
		await run();
		expect(await outbox()).toEqual([]);
		await pull();
		const synced = await getNovelView(env.novel.id, env.user.id, env.db);
		expect(shape(synced.keywords as never)).toEqual(
			shape(predicted.keywords as never),
		);
		const replacements = (
			rows: { from: string; to: string; keywordId: unknown }[],
		) => rows.map((row) => [row.from, row.to, row.keywordId]).sort();
		expect(replacements(synced.replacements)).toEqual(
			replacements(predicted.replacements),
		);
	});
});

describe("resolution actions (phase 7 tests 3–5)", () => {
	it("creates a deleted keyword again under a new ID, leaving its children's updates to discard", async () => {
		const keyword = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Lost", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		const alias = {
			id: crypto.randomUUID(),
			keywordId: keyword.id,
			nameAr: null,
			nameEn: "Lost alias",
			description: null,
			matchingType: "FULL",
			overrideStyle: false,
			categoryId: null,
			natureId: null,
			imageId: null,
			createdById: env.user.id,
			createdAt: env.api.now(),
			updatedAt: env.api.now(),
		};
		env.api.aliases.set(alias.id, alias);
		await pull();
		const update = await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: keyword.id,
				changes: { nameEn: "Lost 2" },
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keywordAlias",
				op: "update",
				id: alias.id,
				changes: { nameEn: "Lost alias 2" },
			},
			{ db: env.db },
		);
		env.api.deleteRow("keyword", keyword.id);
		await pull();
		expect((await outbox()).map((row) => row.conflict?.kind)).toEqual([
			"deleted",
			"deleted",
		]);
		await applyResolution(
			update.mutationId as string,
			{ kind: "createAgain" },
			{ db: env.db },
		);
		const [recreate, aliasUpdate] = await outbox();
		expect([recreate?.op, recreate?.status]).toEqual(["create", "pending"]);
		expect(recreate?.entityId).not.toBe(keyword.id);
		expect(recreate?.patch).toMatchObject({
			nameEn: "Lost 2",
			categoryId: env.category.id,
			natureId: env.nature.id,
		});
		expect(aliasUpdate?.conflict?.kind).toBe("deleted");
		await run();
		expect(
			[...env.api.keywords.values()].some((row) => row.nameEn === "Lost 2"),
		).toBe(true);
		await discardMutation(aliasUpdate?.id as string, { db: env.db });
		expect(await outbox()).toEqual([]);
	});

	it("replaces a duplicate's name on Edit and sends it on the next run", async () => {
		await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: values("Twin"),
			},
			{ db: env.db },
		);
		env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Twin", categoryId: env.category.id, natureId: env.nature.id },
			"other-device",
		);
		await run();
		const [conflict] = await outbox();
		expect(conflict?.conflict?.kind).toBe("duplicate");
		await applyResolution(
			conflict?.id as string,
			{ kind: "edit", patch: { nameEn: "Twin two" } },
			{ db: env.db },
		);
		const [edited] = await outbox();
		expect([
			edited?.status,
			edited?.patch.nameEn,
			edited?.patch.categoryId,
		]).toEqual(["pending", "Twin two", env.category.id]);
		await run();
		expect(await outbox()).toEqual([]);
		expect(
			[...env.api.keywords.values()].map((row) => row.nameEn).sort(),
		).toEqual(["Twin", "Twin two"]);
	});

	it("sends another account's held changes once that account signs back in", async () => {
		await enqueue(
			{
				entity: "replacement",
				op: "create",
				novelId: env.novel.id,
				values: { from: "held", to: "x" },
			},
			{ db: env.db },
		);
		const other = makeUser("reader-2");
		env.api.addUser(other.id);
		await signIn(other);
		await run();
		expect(env.api.replacements.size).toBe(0);
		expect((await outbox())[0]?.userId).toBe(env.user.id);
		await signIn(env.user);
		await run();
		expect(await outbox()).toEqual([]);
		expect([...env.api.replacements.values()][0]?.createdById).toBe(
			env.user.id,
		);
	});
});

describe("pull scenarios (phase 5 tests 2, 3, 6 and phase 9 test 6)", () => {
	it("loses nothing when another context enqueues during a pull", async () => {
		for (let index = 0; index < 50; index++)
			env.api.seedKeyword(env.novel.id, {
				nameEn: `S${index}`,
				categoryId: env.category.id,
				natureId: env.nature.id,
			});
		const popup = await secondContext();
		await Promise.all([
			pullNovel(env.novel.id, { db: env.db, token }),
			...Array.from({ length: 10 }, (_, index) =>
				enqueue(
					{
						entity: "replacement",
						op: "create",
						novelId: env.novel.id,
						values: { from: `p${index}`, to: "t" },
					},
					{ db: popup },
				),
			),
		]);
		expect(await env.db.mutations.count()).toBe(10);
		expect(
			(await getNovelView(env.novel.id, env.user.id, env.db)).replacements
				.length,
		).toBe(10);
		expect(
			await env.db.keywords.where("novelId").equals(env.novel.id).count(),
		).toBe(50);
	});

	it("pulls every unit even with a rejected change and a pending category create", async () => {
		env = await setupEngine({ moderator: true });
		const other = env.api.seedNovel({ nameEn: "Other" });
		await pullCatalogue({ db: env.db, token });
		await pinNovel(env.novel.id, env.db);
		await pinNovel(other.id, env.db);
		await enqueue(
			{
				entity: "keywordCategory",
				op: "create",
				values: { nameEn: "Pending", color: "#000000" },
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "replacement",
				op: "create",
				novelId: env.novel.id,
				values: { from: "r", to: "s" },
			},
			{ db: env.db },
		);
		const replacement = (await outbox()).find(
			(row) => row.entity === "replacement",
		);
		await env.db.mutations.update(replacement?.seq as number, {
			status: "rejected",
		});
		env.api.requests = [];
		const summary = await pullDueUnits({ db: env.db, token }, { mode: "all" });
		expect(summary.pulledUnits).toBe(4);
		const paths = env.api.requests.map((request) => request.path);
		expect(paths).toContain(`/novels/${env.novel.id}`);
		expect(paths).toContain(`/novels/${other.id}`);
		expect(paths).toContain("/keyword-categories/");
	});

	it("turns a pending create using a category deleted on the server into parent-missing", async () => {
		await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: values("Orphan"),
			},
			{ db: env.db },
		);
		env.api.deleteRow("keywordCategory", env.category.id);
		await pullLookups({ db: env.db, token });
		expect(await env.db.keywordCategories.get(env.category.id)).toBeUndefined();
		await run();
		expect((await outbox())[0]?.conflict?.kind).toBe("parent-missing");
	});

	it("sees writes made during a full pull on the next delta pull, without duplicates", async () => {
		const keyword = env.api.seedKeyword(env.novel.id, {
			nameEn: "During",
			categoryId: env.category.id,
			natureId: env.nature.id,
		});
		// A change lands after the pull read its cursor but before it fetched the rows.
		const original = env.api.adapter;
		let injected = false;
		env.api.adapter = async (config) => {
			const response = await original(config);
			if (
				!injected &&
				String(config.url).endsWith(`/sync/novels/${env.novel.id}/changes`)
			) {
				injected = true;
				env.api.editRow(
					env.api.keywords,
					keyword.id,
					{ nameEn: "During 2" },
					"keyword",
				);
			}
			return response;
		};
		const { axiosInstance } = await import("../../../src/api/axios-instance");
		axiosInstance.defaults.adapter = env.api.adapter;
		await pullNovel(env.novel.id, { db: env.db, token });
		env.api.editRow(
			env.api.keywords,
			keyword.id,
			{ nameEn: "During 3" },
			"keyword",
		);
		env.api.requests = [];
		await refreshNovel(env.novel.id, { db: env.db, token });
		expect(env.api.requests.map((request) => request.path)).toEqual([
			`/sync/novels/${env.novel.id}/changes`,
		]);
		const rows = await env.db.keywords
			.where("novelId")
			.equals(env.novel.id)
			.toArray();
		expect(rows.map((row) => row.nameEn)).toEqual(["During 3"]);
	});
});
