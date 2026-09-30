/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { setOnline, setupEngine } from "../../helpers/engine";
import { fakeBrowser } from "../../helpers/fake-browser";

const { enqueue } = await import("../../../src/lib/offline/outbox");
const { getNovelView, getCatalogueView, getDownloadedNovels } = await import(
	"../../../src/lib/offline/views"
);
const { runSync } = await import("../../../src/lib/offline/sync/runner");
const { pullNovel, pullLookups, pullCatalogue, pullDueUnits, refreshNovel } =
	await import("../../../src/lib/offline/sync/pull");
const { pinNovel, getNovelSync } = await import(
	"../../../src/lib/offline/meta"
);
const { loadNovelContentDataForMeta } = await import(
	"../../../src/lib/offline/load-novel-content-data"
);
const { downloadNovel, removeDownload } = await import(
	"../../../src/lib/offline/sync/service"
);
const { setTabNovel, refreshNovelTabs, resetTabRefreshThrottleForTests } =
	await import("../../../src/lib/offline/sync/tabs");

type Env = Awaited<ReturnType<typeof setupEngine>>;
let env: Env;
const token = "token-reader-1";
const ctx = () => ({ db: env.db, token });
const gets = () =>
	env.api.requests.filter((request) => request.method === "GET");

beforeEach(async () => {
	env = await setupEngine();
	resetTabRefreshThrottleForTests();
});

describe("pulls", () => {
	it("replace the snapshot but keep every local change", async () => {
		const keyword = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "K", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		await pullLookups(ctx());
		await pullNovel(env.novel.id, ctx());
		const created = await enqueue(
			{
				entity: "keywordAlias",
				op: "create",
				keywordId: keyword.id,
				values: { nameEn: "A" },
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: keyword.id,
				changes: { nameEn: "K local" },
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
		env.api.editRow(
			env.api.keywords,
			keyword.id,
			{ matchingType: "PARTIAL" },
			"keyword",
		);
		await pullNovel(env.novel.id, ctx());
		const view = await getNovelView(env.novel.id, env.user.id, env.db);
		const local = view.keywords.find((item) => item.id === keyword.id);
		expect(local).toMatchObject({ nameEn: "K local", matchingType: "PARTIAL" });
		expect(local?.aliases.map((alias) => alias.id)).toEqual([created.entityId]);
		expect(view.replacements.map((row) => row.from)).toEqual(["a"]);
		expect((await env.db.keywords.get(keyword.id))?.nameEn).toBe("K");
	});

	it("fetch every page of large novels in both languages", async () => {
		for (let index = 0; index < 1100; index++) {
			env.api.seedKeyword(
				env.novel.id,
				index % 2
					? {
							nameEn: `K${index}`,
							categoryId: env.category.id,
							natureId: env.nature.id,
						}
					: {
							nameAr: `ك${index}`,
							categoryId: env.category.id,
							natureId: env.nature.id,
						},
			);
		}
		await pullNovel(env.novel.id, ctx());
		expect(
			await env.db.keywords.where("novelId").equals(env.novel.id).count(),
		).toBe(1100);
	});

	it("prune deleted lookups and catalogue novels, keeping removed downloads marked", async () => {
		const pinned = env.api.seedNovel({ nameEn: "Pinned" });
		const gone = env.api.seedNovel({ nameEn: "Gone" });
		await pullCatalogue(ctx());
		await pullLookups(ctx());
		await pinNovel(pinned.id, env.db);
		env.api.deleteRow("novel", pinned.id);
		env.api.deleteRow("novel", gone.id);
		env.api.deleteRow("keywordCategory", env.category.id);
		await pullCatalogue(ctx());
		await pullLookups(ctx());
		const catalogue = (await getCatalogueView(env.db)).map((novel) => novel.id);
		expect(catalogue).toContain(pinned.id);
		expect(catalogue).not.toContain(gone.id);
		expect((await getNovelSync(pinned.id, env.db))?.removedOnServer).toBe(true);
		expect(await env.db.keywordCategories.get(env.category.id)).toBeUndefined();
	});

	it("mark a novel removed on the server and its pending updates deleted", async () => {
		const keyword = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "K", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		await pullNovel(env.novel.id, ctx());
		await enqueue(
			{
				entity: "keyword",
				op: "update",
				id: keyword.id,
				changes: { nameEn: "K2" },
			},
			{ db: env.db },
		);
		env.api.deleteRow("novel", env.novel.id);
		expect(await pullNovel(env.novel.id, ctx())).toBe("removed");
		expect((await env.db.mutations.toArray())[0]?.conflict?.kind).toBe(
			"deleted",
		);
		expect((await getNovelSync(env.novel.id, env.db))?.removedOnServer).toBe(
			true,
		);
	});

	it("pull due units only, never skipping lookups for pending lookup changes", async () => {
		await pinNovel(env.novel.id, env.db);
		const first = await pullDueUnits(ctx(), { reason: "popup-open" });
		expect(first.pulledUnits).toBe(3);
		env.api.requests = [];
		const second = await pullDueUnits(ctx(), { reason: "popup-open" });
		expect([second.pulledUnits, gets().length]).toEqual([0, 0]);
		const all = await pullDueUnits(ctx(), { mode: "all" });
		expect(all.pulledUnits).toBe(3);
	});

	it("record a failed unit and keep pulling the others", async () => {
		const other = env.api.seedNovel({ nameEn: "Other" });
		await pinNovel(env.novel.id, env.db);
		await pinNovel(other.id, env.db);
		env.api.failNext(
			{ kind: "status", status: 500 },
			(method, path) => method === "GET" && path === `/novels/${env.novel.id}`,
		);
		const summary = await pullDueUnits(ctx(), { mode: "all" });
		expect(summary.failedUnits).toBe(1);
		expect(
			(await getNovelSync(env.novel.id, env.db))?.lastPullError,
		).toBeTruthy();
		expect(
			(await getNovelSync(other.id, env.db))?.lastPulledAt,
		).toBeGreaterThan(0);
	});

	it("pull the novel again after a replacement create rewrote a chain", async () => {
		env.api.seedKeyword(env.novel.id, {
			nameEn: "Hub",
			categoryId: env.category.id,
			natureId: env.nature.id,
		});
		await pullNovel(env.novel.id, ctx());
		env.api.replacements.set("r0", {
			id: "r0",
			from: "a",
			to: "b",
			novelId: env.novel.id,
			keywordId: null,
			matchingType: "FULL",
			createdById: "x",
			createdAt: env.api.now(),
			updatedAt: env.api.now(),
		});
		await enqueue(
			{
				entity: "replacement",
				op: "create",
				novelId: env.novel.id,
				values: { from: "b", to: "Hub" },
			},
			{ db: env.db },
		);
		await runSync({ reason: "enqueue", db: env.db });
		expect((await env.db.replacements.get("r0"))?.to).toBe("Hub");
	});
});

describe("delta sync", () => {
	it("refreshes from the cursor and matches a full pull", async () => {
		const keep = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Keep", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		const drop = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Drop", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		await pullNovel(env.novel.id, ctx());
		expect((await getNovelSync(env.novel.id, env.db))?.cursor).toBeGreaterThan(
			0,
		);
		env.api.editRow(env.api.keywords, keep.id, { nameEn: "Keep 2" }, "keyword");
		env.api.deleteRow("keyword", drop.id);
		const created = env.api.seedKeyword(env.novel.id, {
			nameEn: "New",
			categoryId: env.category.id,
			natureId: env.nature.id,
		});
		env.api.requests = [];
		await refreshNovel(env.novel.id, ctx());
		expect(gets().map((request) => request.path)).toEqual([
			`/sync/novels/${env.novel.id}/changes`,
		]);
		const delta = (
			await env.db.keywords.where("novelId").equals(env.novel.id).toArray()
		)
			.map((row) => row.nameEn)
			.sort();
		await pullNovel(env.novel.id, ctx());
		const full = (
			await env.db.keywords.where("novelId").equals(env.novel.id).toArray()
		)
			.map((row) => row.nameEn)
			.sort();
		expect(delta).toEqual(full);
		expect(delta).toEqual(["Keep 2", "New"]);
		expect(
			await env.db.keywordVersions
				.where("keywordId")
				.equals(created.id)
				.count(),
		).toBe(1);
	});

	it("marks pending updates of deleted keywords and their children as conflicts", async () => {
		const keyword = env.api.seedKeyword(
			env.novel.id,
			{
				nameEn: "Merged",
				categoryId: env.category.id,
				natureId: env.nature.id,
			},
			env.user.id,
		);
		const alias = {
			id: crypto.randomUUID(),
			keywordId: keyword.id,
			nameAr: null,
			nameEn: "Al",
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
		await pullNovel(env.novel.id, ctx());
		await enqueue(
			{
				entity: "keywordAlias",
				op: "update",
				id: alias.id,
				changes: { nameEn: "Al 2" },
			},
			{ db: env.db },
		);
		env.api.deleteRow("keyword", keyword.id);
		await refreshNovel(env.novel.id, ctx());
		expect(await env.db.keywords.get(keyword.id)).toBeUndefined();
		expect(await env.db.keywordAliases.get(alias.id)).toBeUndefined();
		expect((await env.db.mutations.toArray())[0]?.conflict?.kind).toBe(
			"deleted",
		);
	});

	it("pages in order and falls back to a full pull on an expired cursor", async () => {
		await pullNovel(env.novel.id, ctx());
		for (let index = 0; index < 5; index++)
			env.api.seedKeyword(env.novel.id, {
				nameEn: `P${index}`,
				categoryId: env.category.id,
				natureId: env.nature.id,
			});
		env.api.prunedBefore = Number.MAX_SAFE_INTEGER;
		env.api.requests = [];
		await refreshNovel(env.novel.id, ctx());
		expect(
			gets().some((request) => request.path === `/novels/${env.novel.id}`),
		).toBe(true);
		expect(
			await env.db.keywords.where("novelId").equals(env.novel.id).count(),
		).toBe(5);
	});

	it("applies lookup and catalogue changes", async () => {
		await pullLookups(ctx());
		await pullCatalogue(ctx());
		const added = env.api.seedNovel({ nameEn: "Added" });
		env.api.deleteRow("keywordNature", env.nature.id);
		await runSync({ reason: "manual", manual: true, pull: "all", db: env.db });
		expect((await getCatalogueView(env.db)).map((novel) => novel.id)).toContain(
			added.id,
		);
		expect(await env.db.keywordNatures.get(env.nature.id)).toBeUndefined();
	});
});

describe("page data and downloads", () => {
	it("pulls a missing novel for the page, serves stale data at once and refreshes it", async () => {
		env.api.seedKeyword(env.novel.id, {
			nameEn: "Mira",
			categoryId: env.category.id,
			natureId: env.nature.id,
		});
		const kick = (options: { forceCatalogue?: boolean }) =>
			runSync({ reason: "page", db: env.db, ...options });
		const first = await loadNovelContentDataForMeta(
			{ novelSlug: "novel-slug" },
			{ db: env.db, kick, waitMs: 3000 },
		);
		expect(first?.keywords.map((keyword) => keyword.nameEn)).toEqual(["Mira"]);
		await env.db.novelSync.update(env.novel.id, { lastPulledAt: 1 });
		let kicked = 0;
		const second = await loadNovelContentDataForMeta(
			{ novelSlug: "novel-slug" },
			{
				db: env.db,
				kick: async () => {
					kicked += 1;
				},
				waitMs: 100,
			},
		);
		expect(second?.keywords.length).toBe(1);
		expect(kicked).toBe(1);
		expect(
			(await getNovelSync(env.novel.id, env.db))?.refreshRequestedAt,
		).toBeGreaterThan(0);
	});

	it("serves a language switch without network, and nothing offline without data", async () => {
		env.api.seedKeyword(env.novel.id, {
			nameAr: "ميرا",
			nameEn: "Mira",
			categoryId: env.category.id,
			natureId: env.nature.id,
		});
		env.api.seedKeyword(env.novel.id, {
			nameAr: "لين",
			categoryId: env.category.id,
			natureId: env.nature.id,
		});
		await pullCatalogue(ctx());
		await pullNovel(env.novel.id, ctx());
		setOnline(false);
		await fakeBrowser.storage.local.set({ "storylens-locale": "ar" });
		const kick = async () => undefined;
		const arabic = await loadNovelContentDataForMeta(
			{ novelSlug: "novel-slug" },
			{ db: env.db, kick },
		);
		expect(arabic?.keywords.map((keyword) => keyword.nameAr).sort()).toEqual([
			"لين",
			"ميرا",
		]);
		env.api.seedNovel({ nameEn: "Other", slugs: ["other"] });
		await pullCatalogue(ctx()).catch(() => undefined);
		expect(
			await loadNovelContentDataForMeta(
				{ novelSlug: "other" },
				{ db: env.db, kick },
			),
		).toBeUndefined();
		setOnline(true);
	});

	it("downloads and refuses removal with pending changes until discarded", async () => {
		setOnline(false);
		expect(await downloadNovel(env.novel.id, env.db)).toEqual({
			error: "offline",
		});
		setOnline(true);
		expect(await downloadNovel(env.novel.id, env.db)).toEqual({ ok: true });
		expect(
			(await getDownloadedNovels(env.db)).map((novel) => novel.id),
		).toEqual([env.novel.id]);
		await enqueue(
			{
				entity: "replacement",
				op: "create",
				novelId: env.novel.id,
				values: { from: "a", to: "b" },
			},
			{ db: env.db },
		);
		expect(await removeDownload(env.novel.id, {}, env.db)).toEqual({
			blocked: 1,
		});
		expect(
			await removeDownload(env.novel.id, { discardPending: true }, env.db),
		).toEqual({ ok: true });
		expect(await env.db.mutations.count()).toBe(0);
		expect(await getDownloadedNovels(env.db)).toEqual([]);
	});

	it("refreshes tabs showing a changed novel, throttled, across worker restarts", async () => {
		await setTabNovel(7, { novelSlug: "novel-slug", novelId: env.novel.id });
		await setTabNovel(8, { novelSlug: "other", novelId: "other-id" });
		const sent: number[] = [];
		const send = async (tabId: number) => sent.push(tabId);
		expect(await refreshNovelTabs([env.novel.id], send)).toEqual([7]);
		expect(await refreshNovelTabs([env.novel.id], send)).toEqual([]);
		resetTabRefreshThrottleForTests();
		expect(
			await refreshNovelTabs([env.novel.id], send, Date.now() + 5000),
		).toEqual([7]);
	});
});

describe("offline storage unavailable (phase 6.7)", () => {
	it("serves page data from the API and refuses edits with a reason", async () => {
		const { StoryLensDatabase, setOfflineDbForTests, openOfflineDb } =
			await import("../../../src/lib/offline/db");
		const { StorageUnavailable } = await import(
			"../../../src/lib/offline/outbox"
		);
		env.api.seedKeyword(env.novel.id, {
			nameEn: "Online only",
			categoryId: env.category.id,
			natureId: env.nature.id,
		});
		const broken = new StoryLensDatabase("broken-profile");
		broken.open = () =>
			Promise.reject(new Error("blocked")) as ReturnType<typeof broken.open>;
		setOfflineDbForTests(broken);
		expect(await openOfflineDb()).toBeNull();
		try {
			const data = await loadNovelContentDataForMeta(
				{ novelSlug: "novel-slug" },
				{ kick: async () => undefined },
			);
			expect(data?.keywords.map((keyword) => keyword.nameEn)).toEqual([
				"Online only",
			]);
			await expect(
				enqueue({
					entity: "replacement",
					op: "create",
					novelId: env.novel.id,
					values: { from: "a", to: "b" },
				}),
			).rejects.toBeInstanceOf(StorageUnavailable);
		} finally {
			setOfflineDbForTests(env.db);
		}
	});
});
