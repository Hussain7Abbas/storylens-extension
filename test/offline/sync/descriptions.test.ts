import { beforeEach, describe, expect, it } from "bun:test";
import { setupEngine } from "../../helpers/engine";

const { enqueue } = await import("../../../src/lib/offline/outbox");
const { getNovelView } = await import("../../../src/lib/offline/views");
const { pullLookups } = await import("../../../src/lib/offline/sync/pull");
const { runSync } = await import("../../../src/lib/offline/sync/runner");
let env: Awaited<ReturnType<typeof setupEngine>>;
beforeEach(async () => {
	env = await setupEngine();
});
const view = () => getNovelView(env.novel.id, env.user.id, env.db);
const sync = () => runSync({ reason: "enqueue", db: env.db, pull: "none" });

describe("bilingual descriptions offline and after sync", () => {
	it("round trips keyword/alias descriptions and changes one language independently", async () => {
		await pullLookups({ db: env.db, token: "token-reader-1" });
		const created = await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: {
					nameEn: "Mira",
					nameAr: "ميرا",
					descriptionEn: "English keyword",
					descriptionAr: "وصف الكلمة",
					categoryId: env.category.id,
					natureId: env.nature.id,
				},
			},
			{ db: env.db },
		);
		const alias = await enqueue(
			{
				entity: "keywordAlias",
				op: "create",
				keywordId: created.entityId,
				values: {
					nameEn: "Little Mira",
					nameAr: "ميرا الصغيرة",
					descriptionEn: "English alias",
					descriptionAr: "وصف الاسم البديل",
				},
			},
			{ db: env.db },
		);
		const pending = (await view()).keywords.find(
			(row) => row.id === created.entityId,
		);
		expect(
			(await env.db.mutations.toArray())[0]?.patch.description,
		).toBeUndefined();
		expect(pending?.versions[0]).toMatchObject({
			descriptionEn: "English keyword",
			descriptionAr: "وصف الكلمة",
		});
		expect(pending?.aliases[0]).toMatchObject({
			descriptionEn: "English alias",
			descriptionAr: "وصف الاسم البديل",
		});
		await sync();
		expect(await env.db.mutations.count()).toBe(0);
		const saved = (await view()).keywords.find(
			(row) => row.id === created.entityId,
		);
		expect(saved?.versions[0]).toMatchObject({
			descriptionEn: "English keyword",
			descriptionAr: "وصف الكلمة",
		});
		expect(saved?.aliases[0]).toMatchObject({
			descriptionEn: "English alias",
			descriptionAr: "وصف الاسم البديل",
		});
		if (!saved) throw new Error("keyword missing");
		await enqueue(
			{
				entity: "keywordVersion",
				op: "update",
				id: saved.versions[0].id,
				changes: { descriptionAr: "وصف جديد" },
				seen: { descriptionAr: "وصف الكلمة" },
				seenUpdatedAt: String(saved.versions[0].updatedAt),
			},
			{ db: env.db },
		);
		await enqueue(
			{
				entity: "keywordAlias",
				op: "update",
				id: alias.entityId,
				changes: { descriptionAr: null },
				seen: { descriptionAr: "وصف الاسم البديل" },
				seenUpdatedAt: String(saved.aliases[0].updatedAt),
			},
			{ db: env.db },
		);
		await sync();
		expect(await env.db.mutations.count()).toBe(0);
		const updated = (await view()).keywords.find(
			(row) => row.id === created.entityId,
		);
		expect(updated?.versions[0]).toMatchObject({
			descriptionEn: "English keyword",
			descriptionAr: "وصف جديد",
		});
		expect(updated?.aliases[0]).toMatchObject({
			descriptionEn: "English alias",
			descriptionAr: null,
		});
	});
});
