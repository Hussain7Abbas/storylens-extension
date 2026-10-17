import { expect, it } from "bun:test";
import { enqueue } from "../../../src/lib/offline/outbox";
import { pullLookups, pullNovel } from "../../../src/lib/offline/sync/pull";
import { runSync } from "../../../src/lib/offline/sync/runner";
import { getNovelView } from "../../../src/lib/offline/views";
import { setOnline, setupEngine } from "../../helpers/engine";

it("keeps image prompts with keywords, aliases and versions offline, through sync and after edits", async () => {
	const env = await setupEngine();
	await pullLookups({ db: env.db, token: "token-reader-1" });
	const prompt = "Ink portrait.\nSilver hair and a blue cloak.";
	setOnline(false);
	const keyword = await enqueue(
		{
			entity: "keyword",
			op: "create",
			novelId: env.novel.id,
			values: {
				nameEn: "Mira",
				categoryId: env.category.id,
				natureId: env.nature.id,
				imagePrompt: prompt,
			},
		},
		{ db: env.db },
	);
	const alias = await enqueue(
		{
			entity: "keywordAlias",
			op: "create",
			keywordId: keyword.entityId,
			values: { nameEn: "Scout", imagePrompt: `${prompt} Hood up.` },
		},
		{ db: env.db },
	);
	const version = await enqueue(
		{
			entity: "keywordVersion",
			op: "create",
			keywordId: keyword.entityId,
			values: { currentChapter: 10, imagePrompt: `${prompt} Older.` },
		},
		{ db: env.db },
	);
	const view = async () =>
		(await getNovelView(env.novel.id, env.user.id, env.db)).keywords.find(
			(row) => row.id === keyword.entityId,
		);
	const assertPrompts = async () => {
		const row = await view();
		expect(
			row?.versions.find((item) => item.id === keyword.versionId)?.imagePrompt,
		).toBe(prompt);
		expect(
			row?.aliases.find((item) => item.id === alias.entityId)?.imagePrompt,
		).toBe(`${prompt} Hood up.`);
		expect(
			row?.versions.find((item) => item.id === version.entityId)?.imagePrompt,
		).toBe(`${prompt} Older.`);
	};
	await assertPrompts();
	setOnline(true);
	await runSync({ reason: "enqueue", db: env.db, pull: "none" });
	expect(await env.db.mutations.count()).toBe(0);
	await pullNovel(env.novel.id, { db: env.db, token: "token-reader-1" });
	await assertPrompts();
	setOnline(false);
	await enqueue(
		{
			entity: "keywordVersion",
			op: "update",
			id: keyword.versionId as string,
			changes: { imagePrompt: "Red cloak instead." },
		},
		{ db: env.db },
	);
	await enqueue(
		{
			entity: "keywordAlias",
			op: "update",
			id: alias.entityId,
			changes: { imagePrompt: null },
		},
		{ db: env.db },
	);
	setOnline(true);
	await runSync({ reason: "enqueue", db: env.db, pull: "none" });
	expect(await env.db.mutations.count()).toBe(0);
	expect(
		(await view())?.versions.find((item) => item.id === keyword.versionId)
			?.imagePrompt,
	).toBe("Red cloak instead.");
	expect((await view())?.aliases[0]?.imagePrompt).toBeNull();
});
