/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import "../../helpers/fake-browser";
import type { Mutation } from "../../../src/lib/offline/types";

const { merge, sameValue } = await import(
	"../../../src/lib/offline/rules/merge"
);
const { pickNext, nextWakeAt, backoffDelay } = await import(
	"../../../src/lib/offline/sync/scheduler"
);
const { classify } = await import("../../../src/lib/offline/sync/classify");
const validation = await import("../../../src/lib/offline/rules/validation");
const permissions = await import("../../../src/lib/auth/permissions");
const forms = await import("../../../src/lib/offline/form-changes");
const { syncIndicator } = await import(
	"../../../src/lib/offline/sync/indicator"
);
const { deriveStatus, badgeFor } = await import(
	"../../../src/lib/offline/sync/status"
);
const { fetchAllPages } = await import("../../../src/utils/fetch-all-pages");

let seq = 0;
function mutation(fields: Partial<Mutation>): Mutation {
	seq += 1;
	return {
		seq,
		id: `m${seq}`,
		userId: "a",
		userLabel: "a",
		entity: "keyword",
		op: "update",
		entityId: `e${seq}`,
		novelId: "n",
		dependsOn: [],
		patch: {},
		actor: { moderator: false },
		createdAt: 0,
		updatedAt: 0,
		status: "pending",
		attempts: 0,
		nextAttemptAt: 0,
		...fields,
	};
}

describe("three-way merge", () => {
	it("reports a deleted row", () => {
		expect(merge({}, { a: 1 }, null)).toEqual({ deleted: true });
	});
	it("drops fields the server already has and keeps unchanged ones", () => {
		const result = merge(
			{ a: "x", b: "y" },
			{ a: "new", b: "same" },
			{ a: "x", b: "same", updatedAt: "t2" },
		);
		expect(result).toEqual({
			deleted: false,
			autoPatch: { a: "new" },
			conflicts: [],
			newBase: { a: "x" },
			newBaseUpdatedAt: "t2",
		});
	});
	it("flags true conflicts per field", () => {
		const result = merge(
			{ a: "x" },
			{ a: "mine" },
			{ a: "theirs", updatedAt: "t" },
		);
		expect(result.deleted === false && result.conflicts).toEqual([
			{ field: "a", base: "x", mine: "mine", theirs: "theirs" },
		]);
	});
	it("treats empty text alike and trims", () => {
		expect(sameValue("", null)).toBe(true);
		expect(sameValue(undefined, null)).toBe(true);
		expect(sameValue(" a ", "a")).toBe(true);
		expect(sameValue(0, null)).toBe(false);
		const result = merge(
			{ description: "old" },
			{ description: "" },
			{ description: null, updatedAt: "t" },
		);
		expect(result.deleted === false && result.autoPatch).toEqual({});
	});
	it("keeps a field missing from the base", () => {
		const result = merge(undefined, { a: 1 }, { a: 2, updatedAt: "t" });
		expect(result.deleted === false && result.autoPatch).toEqual({ a: 1 });
	});
});

describe("scheduler", () => {
	it("sends the lowest seq of the account, skipping other accounts", () => {
		const other = mutation({ userId: "b" });
		const mine = mutation({});
		expect(pickNext([other, mine], { userId: "a", now: 0 })?.id).toBe(mine.id);
	});
	it("never sends a later mutation of an entity before an earlier one", () => {
		const first = mutation({ entityId: "k", nextAttemptAt: 1000 });
		const second = mutation({ entityId: "k" });
		const other = mutation({ entityId: "z" });
		expect(pickNext([first, second, other], { userId: "a", now: 0 })?.id).toBe(
			other.id,
		);
		expect(
			pickNext([first, second], { userId: "a", now: 0, manual: true })?.id,
		).toBe(first.id);
	});
	it("waits for unconfirmed creates in dependsOn, including base versions", () => {
		const create = mutation({
			entityId: "k",
			op: "create",
			status: "conflict",
			patch: { versionId: "v" },
		});
		const alias = mutation({
			entity: "keywordAlias",
			op: "create",
			dependsOn: ["k"],
		});
		const version = mutation({
			entity: "keywordVersion",
			entityId: "v2",
			dependsOn: ["v"],
		});
		expect(
			pickNext([create, alias, version], { userId: "a", now: 0 }),
		).toBeUndefined();
	});
	it("never touches conflicts or rejections, even manually", () => {
		const rejected = mutation({ status: "rejected" });
		expect(
			pickNext([rejected], { userId: "a", now: 0, manual: true }),
		).toBeUndefined();
	});
	it("wakes at the earliest waiting mutation", () => {
		expect(
			nextWakeAt(
				[
					mutation({ nextAttemptAt: 50 }),
					mutation({ nextAttemptAt: 30 }),
					mutation({ userId: "b", nextAttemptAt: 10 }),
				],
				{ userId: "a", now: 0 },
			),
		).toBe(30);
	});
	it("backs off within the jitter bounds and honours Retry-After", () => {
		for (const [attempts, base] of [
			[1, 5000],
			[2, 10000],
			[3, 20000],
			[20, 900000],
		] as const) {
			expect(backoffDelay(attempts, undefined, () => 0)).toBe(base * 0.8);
			expect(backoffDelay(attempts, undefined, () => 1)).toBeCloseTo(
				base * 1.2,
			);
		}
		expect(backoffDelay(1, 120_000, () => 0.5)).toBe(120_000);
	});
	it("property: never picks another account, a blocked entity or an unconfirmed dependency", () => {
		for (let run = 0; run < 300; run++) {
			const pool: Mutation[] = [];
			for (let index = 0; index < 12; index++) {
				pool.push(
					mutation({
						userId: Math.random() < 0.3 ? "b" : "a",
						entityId: `e${Math.floor(Math.random() * 4)}`,
						op: (["create", "update", "delete"] as const)[
							Math.floor(Math.random() * 3)
						],
						status: (
							[
								"pending",
								"pending",
								"inflight",
								"conflict",
								"rejected",
							] as const
						)[Math.floor(Math.random() * 5)],
						nextAttemptAt: Math.random() < 0.3 ? 100 : 0,
						dependsOn:
							Math.random() < 0.3 ? [`e${Math.floor(Math.random() * 4)}`] : [],
					}),
				);
			}
			const picked = pickNext(pool, { userId: "a", now: 0 });
			if (!picked) continue;
			expect(picked.userId).toBe("a");
			const earlier = pool.filter(
				(item) =>
					item.entityId === picked.entityId &&
					(item.seq ?? 0) < (picked.seq ?? 0) &&
					item.userId === "a",
			);
			expect(earlier).toEqual([]);
			for (const dep of picked.dependsOn) {
				expect(
					pool.some(
						(item) =>
							item !== picked && item.op === "create" && item.entityId === dep,
					),
				).toBe(false);
			}
		}
	});
});

describe("classification", () => {
	const update = mutation({});
	const del = mutation({ op: "delete" });
	const create = mutation({ op: "create" });
	it("maps statuses and codes to outcomes", () => {
		expect(classify(update, { ok: true, data: 1 }).type).toBe("success");
		expect(classify(del, { ok: false, status: 404 }).type).toBe("alreadyDone");
		expect(classify(update, { ok: false, status: 404 })).toMatchObject({
			type: "conflict",
			kind: "deleted",
		});
		expect(
			classify(create, { ok: false, status: 404, code: "PARENT_NOT_FOUND" }),
		).toMatchObject({ type: "conflict", kind: "parent-missing" });
		expect(
			classify(update, {
				ok: false,
				status: 409,
				code: "STALE_WRITE",
				body: { current: { id: "x" } },
			}),
		).toMatchObject({ type: "stale" });
		for (const code of [
			"UNIQUE_VIOLATION",
			"KEYWORD_NAME_TAKEN",
			"ALIAS_NAME_TAKEN",
			"REPLACEMENT_EXISTS",
		]) {
			expect(classify(create, { ok: false, status: 409, code })).toMatchObject({
				type: "conflict",
				kind: "duplicate",
			});
		}
		expect(
			classify(create, { ok: false, status: 409, code: "ID_CONFLICT" }),
		).toMatchObject({ type: "rejected", kind: "rule", hint: "create-again" });
		expect(
			classify(update, {
				ok: false,
				status: 400,
				code: "VERSION_NOT_AFTER_LATEST",
			}),
		).toMatchObject({ type: "rejected", kind: "rule" });
		expect(classify(update, { ok: false, status: 403 })).toMatchObject({
			type: "rejected",
			kind: "permission",
		});
		expect(classify(update, { ok: false, status: 401 }).type).toBe("auth");
		expect(classify(update, { ok: false, status: 426 }).type).toBe("upgrade");
		expect(classify(update, { ok: false, status: 503 })).toMatchObject({
			type: "transient",
			reason: "server",
		});
		expect(
			classify(update, { ok: false, status: 429, retryAfterMs: 5 }),
		).toMatchObject({ type: "transient", reason: "server", retryAfterMs: 5 });
		expect(classify(update, { ok: false, network: "offline" })).toMatchObject({
			type: "transient",
			reason: "network",
		});
	});
});

describe("server rule mirrors", () => {
	const version = (id: string, start: number, end: number | null = null) =>
		({
			id,
			keywordId: "k",
			startingChapter: start,
			endingChapter: end,
		}) as never;
	it("checks names per language", () => {
		const keywords = [{ id: "k1", nameAr: "ميرا", nameEn: "Mira" }] as never;
		expect(validation.checkKeywordNames({ nameEn: "Mira" }, keywords)).toBe(
			"KEYWORD_NAME_TAKEN",
		);
		expect(
			validation.checkKeywordNames({ nameEn: "Mira" }, keywords, "k1"),
		).toBeNull();
		expect(
			validation.checkKeywordNames({ nameAr: "Mira" }, keywords),
		).toBeNull();
		expect(validation.checkKeywordNames({ nameAr: " " }, [])).toBe(
			"NAME_REQUIRED",
		);
		expect(
			validation.checkAliasNames({ nameAr: "ميرا" }, [
				{ id: "a", nameAr: "ميرا", nameEn: null },
			] as never),
		).toBe("ALIAS_NAME_TAKEN");
	});
	it("checks replacements", () => {
		const rows = [{ id: "r", from: "a", to: "b" }] as never;
		expect(validation.checkReplacement({ from: "a", to: "c" }, rows)).toBe(
			"REPLACEMENT_EXISTS",
		);
		expect(validation.checkReplacement({ from: "b", to: "a" }, rows)).toBe(
			"REPLACEMENT_BIDIRECTIONAL",
		);
		expect(
			validation.checkReplacement({ from: "a", to: "z" }, rows, "r"),
		).toBeNull();
	});
	it("checks versions", () => {
		const versions = [version("base", 0, 9), version("v10", 10)];
		expect(validation.checkVersionCreate({}, versions, false)).toBe(
			"VERSION_CHAPTER_REQUIRED",
		);
		expect(
			validation.checkVersionCreate({ currentChapter: 10 }, versions, false),
		).toBe("VERSION_NOT_AFTER_LATEST");
		expect(
			validation.checkVersionCreate({ currentChapter: 11 }, versions, false),
		).toBeNull();
		expect(
			validation.checkVersionCreate({ startingChapter: 20 }, versions, true),
		).toBeNull();
		expect(validation.checkVersionDelete("base", versions)).toBe(
			"VERSION_BASE_PROTECTED",
		);
		expect(validation.checkVersionDelete("base", [version("base", 0)])).toBe(
			"VERSION_ONLY_PROTECTED",
		);
		expect(validation.checkVersionDelete("v10", versions)).toBeNull();
	});
	it("checks translation links", () => {
		const base = (id: string) => ({ id, startingChapter: 0 }) as never;
		const source = {
			id: "k2",
			nameEn: "Leo",
			nameAr: null,
			versions: [base("v1")],
		} as never;
		expect(
			validation.checkKeywordTranslation("k1", { nameAr: "ليو" }, source),
		).toBeNull();
		expect(
			validation.checkKeywordTranslation("k2", { nameAr: "ليو" }, source),
		).toBe("TRANSLATION_SELF");
		expect(
			validation.checkKeywordTranslation(
				"k1",
				{ nameAr: "ليو", nameEn: "Leon" },
				source,
			),
		).toBe("TRANSLATION_SAME_LANGUAGE");
		// The same name in both languages is one entity, so the link stands.
		expect(
			validation.checkKeywordTranslation(
				"k1",
				{ nameAr: "ليو", nameEn: "Leo" },
				source,
			),
		).toBeNull();
		expect(
			validation.checkKeywordTranslation("k1", { nameAr: "ليو" }, {
				...(source as object),
				versions: [base("v1"), base("v2")],
			} as never),
		).toBe("TRANSLATION_HAS_VERSIONS");
		const alias = { id: "a2", keywordId: "k1", nameEn: "Leo", nameAr: null };
		expect(
			validation.checkAliasTranslation(
				{ id: "a1", keywordId: "k1", nameAr: "ليو" },
				alias as never,
			),
		).toBeNull();
		expect(
			validation.checkAliasTranslation(
				{ id: "a1", keywordId: "k9", nameAr: "ليو" },
				alias as never,
			),
		).toBe("TRANSLATION_OTHER_KEYWORD");
		expect(
			validation.checkAliasTranslation(
				{ id: "a2", keywordId: "k1", nameAr: "ليو" },
				alias as never,
			),
		).toBe("TRANSLATION_SELF");
	});
	it("offers only rows that add a name without clashing", () => {
		const arabic = { nameAr: "ليو", nameEn: null };
		expect(validation.canTranslate(arabic, { nameEn: "Leo" })).toBe(true);
		// Nothing to add: it names no language the row lacks.
		expect(validation.canTranslate(arabic, { nameAr: "ليو" })).toBe(false);
		expect(validation.canTranslate(arabic, { nameAr: "أمل" })).toBe(false);
		// A row named in both languages fits when its Arabic name is the same one.
		expect(
			validation.canTranslate(arabic, { nameAr: "ليو", nameEn: "Leo" }),
		).toBe(true);
		expect(
			validation.canTranslate(arabic, { nameAr: "أمل", nameEn: "Leo" }),
		).toBe(false);
		// A row named in both languages already takes no translation.
		expect(
			validation.canTranslate(
				{ nameAr: "ليو", nameEn: "Leo" },
				{
					nameEn: "Leon",
				},
			),
		).toBe(false);
		// An unnamed row (a form before its name is typed) takes any.
		expect(validation.canTranslate({ nameAr: " " }, { nameEn: "Leo" })).toBe(
			true,
		);
	});
	it("refuses deleting a lookup in use by a version or an alias", () => {
		expect(
			validation.checkLookupDelete("keywordCategory", "c", {
				versions: [{ categoryId: "c" }] as never,
				aliases: [],
			}),
		).toBe("CATEGORY_IN_USE");
		expect(
			validation.checkLookupDelete("keywordNature", "n", {
				versions: [],
				aliases: [{ natureId: "n" }] as never,
			}),
		).toBe("NATURE_IN_USE");
		expect(
			validation.checkLookupDelete("keywordNature", "n", {
				versions: [],
				aliases: [],
			}),
		).toBeNull();
	});
});

describe("permission rules (D12)", () => {
	const reader = { id: "r", isGuest: false, permissions: [] };
	const owner = { id: "o", isGuest: false, permissions: [] };
	const third = { id: "t", isGuest: false, permissions: [] };
	const moderator = { id: "m", isGuest: false, permissions: ["user:moderate"] };
	const guest = { id: "g", isGuest: true, permissions: [] };
	const ownersKeyword = { createdById: "o" };
	const readersAlias = { createdById: "r" };
	const ownersAlias = { createdById: "o" };
	it("keywords and replacements: creator or moderator", () => {
		expect(permissions.canEditKeyword(reader, ownersKeyword)).toBe(false);
		expect(permissions.canEditKeyword(owner, ownersKeyword)).toBe(true);
		expect(permissions.canDeleteKeyword(moderator, ownersKeyword)).toBe(true);
		expect(permissions.canEditReplacement(reader, { createdById: "r" })).toBe(
			true,
		);
		expect(permissions.canEditReplacement(third, { createdById: "r" })).toBe(
			false,
		);
	});
	it("aliases and versions: own creator, parent keyword creator or moderator", () => {
		expect(permissions.canEditAlias(reader, readersAlias, ownersKeyword)).toBe(
			true,
		);
		expect(permissions.canEditAlias(owner, readersAlias, ownersKeyword)).toBe(
			true,
		);
		expect(permissions.canEditAlias(third, readersAlias, ownersKeyword)).toBe(
			false,
		);
		expect(
			permissions.canEditAlias(moderator, readersAlias, ownersKeyword),
		).toBe(true);
		expect(
			permissions.canEditVersion(reader, ownersAlias, { createdById: "r" }),
		).toBe(true);
		expect(
			permissions.canDeleteVersion(third, ownersAlias, ownersKeyword),
		).toBe(false);
	});
	it("creates need a signed-in reader; lookups and ranges need a moderator", () => {
		expect(permissions.canCreateAlias(reader)).toBe(true);
		expect(permissions.canCreateVersion(guest)).toBe(false);
		expect(permissions.canCreate(null)).toBe(false);
		expect(permissions.canManageLookups(reader)).toBe(false);
		expect(permissions.canManageLookups(moderator)).toBe(true);
		expect(permissions.canSetVersionRange(moderator)).toBe(true);
		expect(permissions.canEditKeyword(guest, { createdById: "g" })).toBe(false);
	});
});

describe("form changes", () => {
	const keyword = {
		name: "Mira",
		matchingType: "FULL" as const,
		fuzzyMatchArabicCharacters: true,
		categoryId: "c",
		natureId: "n",
		description: "d",
		imageId: null,
	};
	it("writes only the side that changed", () => {
		expect(forms.keywordFormChanges(keyword, keyword, "en")).toEqual({
			keyword: undefined,
			baseVersion: undefined,
		});
		expect(
			forms.keywordFormChanges(keyword, { ...keyword, name: "Mira2" }, "en"),
		).toEqual({
			keyword: { changes: { nameEn: "Mira2" }, seen: { nameEn: "Mira" } },
			baseVersion: undefined,
		});
		expect(
			forms.keywordFormChanges(
				keyword,
				{ ...keyword, description: "new" },
				"ar",
			).baseVersion,
		).toEqual({ changes: { description: "new" }, seen: { description: "d" } });
		expect(
			forms.keywordFormChanges(keyword, { ...keyword, description: "" }, "en")
				.baseVersion?.changes,
		).toEqual({ description: null });
		const both = forms.keywordFormChanges(
			keyword,
			{ ...keyword, name: "X", categoryId: "c2" },
			"en",
		);
		expect([both.keyword?.changes, both.baseVersion?.changes]).toEqual([
			{ nameEn: "X" },
			{ categoryId: "c2" },
		]);
	});
	it("diffs the other forms", () => {
		const alias = {
			name: "ميرا",
			matchingType: "FULL" as const,
			fuzzyMatchArabicCharacters: true,
			overrideStyle: false,
			categoryId: null,
			natureId: null,
			description: null,
		};
		expect(
			forms.aliasFormChanges(alias, { ...alias, name: "ميرا٢" }, "ar"),
		).toEqual({ changes: { nameAr: "ميرا٢" }, seen: { nameAr: "ميرا" } });
		expect(
			forms.versionFormChanges(
				{ categoryId: "c", natureId: "n", description: "a" },
				{ categoryId: "c", natureId: "n", description: "a" },
			),
		).toBeUndefined();
		expect(
			forms.replacementFormChanges(
				{ from: "a", to: "b", matchingType: "FULL" },
				{ from: "a", to: "c", matchingType: "FULL" },
			),
		).toEqual({ changes: { to: "c" }, seen: { to: "b" } });
		expect(
			forms.lookupFormChanges(
				{ nameEn: "A", color: "#000000" },
				{ nameEn: "A", color: "#111111" },
			)?.changes,
		).toEqual({ color: "#111111" });
	});
});

describe("status and badge", () => {
	const status = (fields: Partial<ReturnType<typeof deriveStatus>>) => ({
		...deriveStatus([], { userId: "a", runner: "idle", online: true }),
		...fields,
	});
	it("derives counts from the outbox", () => {
		const derived = deriveStatus(
			[
				mutation({}),
				mutation({ status: "inflight" }),
				mutation({ status: "conflict" }),
				mutation({ userId: "b" }),
				mutation({ attempts: 9 }),
			],
			{ userId: "a", runner: "idle", online: true },
		);
		expect([
			derived.pending,
			derived.sending,
			derived.attention,
			derived.otherAccount,
			derived.troubled,
		]).toEqual([2, 1, 1, 1, true]);
	});
	it("shows every state", () => {
		expect(syncIndicator(status({})).icon).toBe("synced");
		expect(syncIndicator(status({ pending: 2 }))).toMatchObject({
			icon: "pending",
			count: 2,
		});
		expect(syncIndicator(status({ sending: 1 })).icon).toBe("sending");
		expect(syncIndicator(status({ online: false }))).toMatchObject({
			icon: "offline",
			canSyncNow: false,
		});
		expect(syncIndicator(status({ attention: 1 }))).toMatchObject({
			icon: "attention",
			count: 1,
		});
		expect(syncIndicator(status({ runner: "authRequired" }))).toMatchObject({
			action: "signIn",
		});
		expect(syncIndicator(status({ runner: "upgradeRequired" }))).toMatchObject({
			action: "update",
		});
		expect(syncIndicator(status({ runner: "apiOutdated" })).message).toBe(
			"sync.status.apiOutdated",
		);
		expect(syncIndicator(status({ unavailable: true })).message).toBe(
			"sync.status.unavailable",
		);
	});
	it("colours the badge", () => {
		expect(badgeFor(status({ pending: 3 }))).toEqual({
			text: "3",
			color: "#f76707",
		});
		expect(badgeFor(status({ attention: 1 })).color).toBe("#e03131");
		expect(badgeFor(status({ online: false })).text).toBe("!");
		expect(badgeFor(status({ pending: 120 })).text).toBe("99+");
	});
});

describe("fetchAllPages", () => {
	const rows = Array.from({ length: 1234 }, (_, index) => index);
	it("requests every page until total", async () => {
		let calls = 0;
		const all = await fetchAllPages(async ({ page, pageSize }) => {
			calls += 1;
			return {
				data: rows.slice((page - 1) * pageSize, page * pageSize),
				total: rows.length,
			};
		});
		expect([all.length, calls]).toEqual([1234, 3]);
	});
	it("stops on an empty page", async () => {
		let calls = 0;
		const all = await fetchAllPages(async () => {
			calls += 1;
			return { data: [], total: 99 };
		});
		expect([all.length, calls]).toEqual([0, 1]);
	});
	it("rejects when aborted and passes the timeout", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			fetchAllPages(async () => ({ data: [1], total: 5 }), {
				signal: controller.signal,
			}),
		).rejects.toThrow();
		let timeout = 0;
		await fetchAllPages(
			async (_, options) => {
				timeout = options.timeout;
				return { data: [], total: 0 };
			},
			{ timeout: 1234 },
		);
		expect(timeout).toBe(1234);
		await expect(
			fetchAllPages(async () =>
				Promise.reject(new Error("timeout of 20000ms exceeded")),
			),
		).rejects.toThrow("timeout");
	});
});
