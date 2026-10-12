import { beforeEach, describe, expect, it } from "bun:test";
import { queuePageReplacement } from "../../src/lib/offline/page-replacement";
import { pullLookups, pullNovel } from "../../src/lib/offline/sync/pull";
import { setTabNovel } from "../../src/lib/offline/sync/tabs";
import { getNovelView } from "../../src/lib/offline/views";
import {
	fakeBrowser,
	makeUser,
	setOnline,
	setupEngine,
	signIn,
} from "../helpers/engine";

let env: Awaited<ReturnType<typeof setupEngine>>;
let keywordId: string;
const sender = {
	id: fakeBrowser.runtime.id,
	tab: { id: 7 },
	frameId: 0,
	url: "https://novels.example.invalid/ch/5",
};
const input = () => ({ novelId: env.novel.id, keywordId, from: "The Scholar" });
beforeEach(async () => {
	env = await setupEngine();
	globalThis.localStorage?.removeItem("locale");
	await fakeBrowser.storage.local.set({ "storylens-locale": "en" });
	const keyword = env.api.seedKeyword(
		env.novel.id,
		{ nameEn: "Mira", categoryId: env.category.id, natureId: env.nature.id },
		env.user.id,
	);
	keywordId = keyword.id;
	await pullLookups({ db: env.db, token: "token-reader-1" });
	await pullNovel(env.novel.id, { db: env.db, token: "token-reader-1" });
	await setTabNovel(7, {
		novelId: env.novel.id,
		novelSlug: "novel-slug",
		chapter: 5,
	});
});
describe("replacement from a tooltip page pick", () => {
	it("uses the canonical keyword as To and makes the replacement visible locally while offline", async () => {
		setOnline(false);
		expect(await queuePageReplacement(input(), sender, env.db)).toEqual({
			ok: true,
			novelSlug: "novel-slug",
		});
		const view = await getNovelView(env.novel.id, env.user.id, env.db);
		expect(view.replacements[0]).toMatchObject({
			from: "The Scholar",
			to: "Mira",
			matchingType: "FULL",
		});
		expect((await env.db.mutations.toArray())[0]?.patch).toMatchObject({
			from: "The Scholar",
			to: "Mira",
		});
		expect(env.api.replacements.size).toBe(0);
	});
	it("refuses duplicate sources without adding another record", async () => {
		await queuePageReplacement(input(), sender, env.db);
		expect(await queuePageReplacement(input(), sender, env.db)).toEqual({
			error: "offline.errors.REPLACEMENT_EXISTS",
		});
		expect(await env.db.mutations.count()).toBe(1);
	});
	it("rejects guests and requests from another novel, iframe or extension", async () => {
		for (const invalid of [
			{ ...sender, id: "other" },
			{ ...sender, frameId: 1 },
			{ ...sender, tab: { id: 8 } },
		])
			expect(await queuePageReplacement(input(), invalid, env.db)).toEqual({
				error: "offline.errors.invalid",
			});
		expect(
			await queuePageReplacement(
				{ ...input(), novelId: crypto.randomUUID() },
				sender,
				env.db,
			),
		).toEqual({ error: "offline.errors.invalid" });
		await signIn(makeUser("guest", { guest: true }));
		expect(await queuePageReplacement(input(), sender, env.db)).toEqual({
			error: "offline.errors.notSignedIn",
		});
		expect(await env.db.mutations.count()).toBe(0);
	});
	it("rejects empty, oversized and missing-keyword picks", async () => {
		for (const invalid of [
			null,
			{ ...input(), from: "" },
			{ ...input(), from: "a".repeat(513) },
			{ ...input(), keywordId: crypto.randomUUID() },
		])
			expect(await queuePageReplacement(invalid, sender, env.db)).toEqual({
				error: "offline.errors.invalid",
			});
		expect(await env.db.mutations.count()).toBe(0);
	});
});
