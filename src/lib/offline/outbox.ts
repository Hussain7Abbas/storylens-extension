import { getStoredAuth } from "@/lib/auth/auth-storage";
import type { AuthUser } from "@/lib/auth/auth-store";
import {
	canCreate,
	canDeleteAlias,
	canDeleteKeyword,
	canDeleteReplacement,
	canDeleteVersion,
	canEditAlias,
	canEditKeyword,
	canEditReplacement,
	canEditVersion,
	canManageLookups,
	isModerator,
} from "@/lib/auth/permissions";
import { allTables, offlineDb, type StoryLensDatabase } from "@/lib/offline/db";
import { newId } from "@/lib/offline/ids";
import { bumpChangeCounter } from "@/lib/offline/meta";
import { projectLookups, projectNovel } from "@/lib/offline/projection";
import { sameValue } from "@/lib/offline/rules/merge";
import {
	checkAliasNames,
	checkKeywordNames,
	checkLookupDelete,
	checkLookupNames,
	checkReplacement,
	checkVersionCreate,
	checkVersionDelete,
	type ValidationCode,
} from "@/lib/offline/rules/validation";
import type {
	AliasRow,
	AssembledKeyword,
	LookupsView,
	Mutation,
	MutationOp,
	NovelView,
	ReplacementRow,
	SyncEntity,
	VersionRow,
} from "@/lib/offline/types";
import { readNovelSnapshot, readUserMutations } from "@/lib/offline/views";

// ---------------------------------------------------------------------------
// Errors (typed, so forms show localized messages)
// ---------------------------------------------------------------------------

export class NotSignedIn extends Error {
	constructor() {
		super("Sign in to make changes");
		this.name = "NotSignedIn";
	}
}

export class PermissionDenied extends Error {
	constructor() {
		super("Only the creator or a moderator can change this");
		this.name = "PermissionDenied";
	}
}

export class ValidationFailed extends Error {
	constructor(readonly code: ValidationCode | "IMAGE_TOO_LARGE") {
		super(code);
		this.name = "ValidationFailed";
	}
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

type MatchingType = "FULL" | "PARTIAL";

export type KeywordValues = {
	nameAr?: string | null;
	nameEn?: string | null;
	matchingType?: MatchingType;
	categoryId: string;
	natureId: string;
	description?: string | null;
	imageId?: string | null;
};
export type KeywordFields = Pick<
	KeywordValues,
	"nameAr" | "nameEn" | "matchingType"
>;

export type AliasValues = {
	nameAr?: string | null;
	nameEn?: string | null;
	description?: string | null;
	matchingType?: MatchingType;
	overrideStyle?: boolean;
	categoryId?: string | null;
	natureId?: string | null;
	imageId?: string | null;
};

export type VersionValues = {
	description?: string | null;
	categoryId?: string | null;
	natureId?: string | null;
	imageId?: string | null;
	/** Readers: the chapter the version starts at. */
	currentChapter?: number | null;
	/** Moderators: the chosen range. */
	startingChapter?: number | null;
	endingChapter?: number | null;
};
export type VersionFields = Omit<VersionValues, "currentChapter">;

export type ReplacementValues = {
	from: string;
	to: string;
	matchingType?: MatchingType;
};

export type LookupValues = {
	nameAr?: string | null;
	nameEn?: string | null;
	color: string;
	description?: string | null;
};

/** An update: the changed fields, the values the form started with, and the row's `updatedAt` then. */
export type Update<T> = {
	changes: Partial<T>;
	seen?: Partial<T>;
	seenUpdatedAt?: string;
};

/** An image picked or generated in a form; kept on the device until uploaded. */
export type QueuedImage = { blob: Blob; name: string; type: string };

export type EnqueueInput =
	| {
			entity: "keyword";
			op: "create";
			novelId: string;
			values: KeywordValues;
			image?: QueuedImage;
	  }
	| ({ entity: "keyword"; op: "update"; id: string } & Update<KeywordFields>)
	| { entity: "keyword"; op: "delete"; id: string }
	| {
			entity: "keywordAlias";
			op: "create";
			keywordId: string;
			values: AliasValues;
			image?: QueuedImage;
	  }
	| ({
			entity: "keywordAlias";
			op: "update";
			id: string;
			image?: QueuedImage;
	  } & Update<AliasValues>)
	| { entity: "keywordAlias"; op: "delete"; id: string }
	| {
			entity: "keywordVersion";
			op: "create";
			keywordId: string;
			values: VersionValues;
			image?: QueuedImage;
	  }
	| ({
			entity: "keywordVersion";
			op: "update";
			id: string;
			image?: QueuedImage;
	  } & Update<VersionFields>)
	| { entity: "keywordVersion"; op: "delete"; id: string }
	| {
			entity: "replacement";
			op: "create";
			novelId: string;
			values: ReplacementValues;
	  }
	| ({
			entity: "replacement";
			op: "update";
			id: string;
	  } & Update<ReplacementValues>)
	| { entity: "replacement"; op: "delete"; id: string }
	| {
			entity: "keywordCategory" | "keywordNature";
			op: "create";
			values: LookupValues;
	  }
	| ({
			entity: "keywordCategory" | "keywordNature";
			op: "update";
			id: string;
	  } & Update<LookupValues>)
	| { entity: "keywordCategory" | "keywordNature"; op: "delete"; id: string };

export type EnqueueResult = {
	entityId: string;
	/** Null when nothing changed, or a create and a delete cancelled out. */
	mutationId: string | null;
	/** A keyword create's base version. */
	versionId?: string;
	/** Queued images take more than 200 MB. */
	warning?: "QUEUED_IMAGES_LARGE";
};

export type EnqueueOptions = {
	db?: StoryLensDatabase;
	user?: AuthUser | null;
	now?: number;
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const QUEUED_IMAGES_WARNING_BYTES = 200 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const UNRESOLVED: readonly string[] = [
	"pending",
	"inflight",
	"conflict",
	"rejected",
];

function cleanText(
	value: string | null | undefined,
): string | null | undefined {
	return value === undefined
		? undefined
		: value === null
			? null
			: value.trim() || null;
}

function defined(row: Row): Row {
	return Object.fromEntries(
		Object.entries(row).filter(([, value]) => value !== undefined),
	);
}

function bySeq(left: Mutation, right: Mutation): number {
	return (left.seq ?? 0) - (right.seq ?? 0);
}

/** The entity's newest unresolved mutation, the one a new change may fold into. */
function tailOf(mutations: Mutation[], entityId: string): Mutation | undefined {
	return mutations
		.filter((mutation) => mutation.entityId === entityId)
		.sort(bySeq)
		.at(-1);
}

/** A create of `entityId` (or of the keyword whose base version it is) not yet confirmed. */
function unconfirmedCreate(
	mutations: Mutation[],
	entityId: string,
): Mutation | undefined {
	return mutations.find(
		(mutation) =>
			mutation.op === "create" &&
			UNRESOLVED.includes(mutation.status) &&
			(mutation.entityId === entityId || mutation.patch.versionId === entityId),
	);
}

/** IDs among `ids` whose creates are still unconfirmed; the new change waits for them. */
function unconfirmedDependencies(
	mutations: Mutation[],
	ids: (string | null | undefined)[],
): string[] {
	const out = new Set<string>();
	for (const id of ids) {
		if (!id) continue;
		const create = unconfirmedCreate(mutations, id);
		if (create) out.add(create.entityId);
	}
	return [...out];
}

/** Keeps only the fields that differ from what the form started with; returns them with that base. */
function diffChanges<T extends Row>(
	changes: Partial<T>,
	seen: Partial<T> | undefined,
	current: Row,
): { patch: Row; base: Row } {
	const patch: Row = {};
	const base: Row = {};
	for (const [field, value] of Object.entries(changes)) {
		if (value === undefined) continue;
		const before = seen && field in seen ? seen[field] : current[field];
		if (sameValue(value, before)) continue;
		patch[field] = value;
		base[field] = before ?? null;
	}
	return { patch, base };
}

function findAlias(
	view: NovelView,
	id: string,
): { alias: AliasRow; keyword: AssembledKeyword } | undefined {
	for (const keyword of view.keywords) {
		const alias = keyword.aliases.find((item) => item.id === id);
		if (alias) return { alias, keyword };
	}
	return undefined;
}

function findVersion(
	view: NovelView,
	id: string,
): { version: VersionRow; keyword: AssembledKeyword } | undefined {
	for (const keyword of view.keywords) {
		const version = keyword.versions.find((item) => item.id === id);
		if (version) return { version, keyword };
	}
	return undefined;
}

/**
 * Mutations to drop with `entityId`: those that depend on its create and
 * aliases or versions under it, recursively. Only unsent ones (not in flight).
 */
export function dependantsOf(
	mutations: Mutation[],
	entityId: string,
): Mutation[] {
	const found = new Map<string, Mutation>();
	const queue = [entityId];
	while (queue.length) {
		const id = queue.shift() as string;
		for (const mutation of mutations) {
			if (found.has(mutation.id) || mutation.status === "inflight") continue;
			if (mutation.dependsOn.includes(id) || mutation.parentId === id) {
				found.set(mutation.id, mutation);
				if (mutation.op === "create") queue.push(mutation.entityId);
			}
		}
	}
	return [...found.values()];
}

async function removeMutations(
	db: StoryLensDatabase,
	mutations: Mutation[],
): Promise<void> {
	for (const mutation of mutations) {
		if (mutation.seq !== undefined) await db.mutations.delete(mutation.seq);
		if (mutation.entity === "file") await db.files.delete(mutation.entityId);
	}
}

/** Drops an unsent image upload that no remaining change uses. */
async function dropOrphanFile(
	db: StoryLensDatabase,
	fileId: unknown,
	mutations: Mutation[],
): Promise<void> {
	if (typeof fileId !== "string") return;
	const upload = mutations.find(
		(mutation) =>
			mutation.entity === "file" &&
			mutation.entityId === fileId &&
			mutation.status === "pending",
	);
	if (!upload) return;
	const users = mutations.filter(
		(mutation) =>
			mutation.id !== upload.id && mutation.patch.imageId === fileId,
	);
	if (users.length) return;
	await removeMutations(db, [upload]);
}

// ---------------------------------------------------------------------------
// enqueue
// ---------------------------------------------------------------------------

type Context = {
	db: StoryLensDatabase;
	user: AuthUser;
	mutations: Mutation[];
	now: number;
	actor: { moderator: boolean };
};

async function readViews(
	ctx: Context,
	novelId: string | null,
): Promise<{ view?: NovelView; lookups: LookupsView }> {
	const [categories, natures] = await Promise.all([
		ctx.db.keywordCategories.toArray(),
		ctx.db.keywordNatures.toArray(),
	]);
	const lookups = projectLookups({
		snapshot: { categories, natures },
		mutations: ctx.mutations,
		userId: ctx.user.id,
	});
	if (!novelId) return { lookups };
	const snapshot = await readNovelSnapshot(ctx.db, novelId);
	return {
		lookups,
		view: projectNovel({
			novelId,
			snapshot,
			lookups,
			mutations: ctx.mutations,
			userId: ctx.user.id,
		}),
	};
}

/** The novel a row belongs to, from the snapshot or from the change that created it. */
async function locateNovel(
	ctx: Context,
	entity: SyncEntity,
	id: string,
): Promise<string | null> {
	const pending = ctx.mutations.find(
		(mutation) =>
			(mutation.entityId === id || mutation.patch.versionId === id) &&
			mutation.novelId,
	);
	if (pending?.novelId) return pending.novelId;
	const { db } = ctx;
	if (entity === "keyword") return (await db.keywords.get(id))?.novelId ?? null;
	if (entity === "replacement")
		return (await db.replacements.get(id))?.novelId ?? null;
	const child =
		entity === "keywordAlias"
			? await db.keywordAliases.get(id)
			: await db.keywordVersions.get(id);
	if (!child) return null;
	return (await db.keywords.get(child.keywordId))?.novelId ?? null;
}

function newMutation(
	ctx: Context,
	fields: Pick<Mutation, "entity" | "op" | "entityId" | "novelId" | "patch"> &
		Partial<Mutation>,
): Mutation {
	return {
		id: newId(),
		userId: ctx.user.id,
		userLabel: ctx.user.username,
		dependsOn: [],
		actor: ctx.actor,
		createdAt: ctx.now,
		updatedAt: ctx.now,
		status: "pending",
		attempts: 0,
		nextAttemptAt: ctx.now,
		...fields,
	};
}

async function append(ctx: Context, mutation: Mutation): Promise<string> {
	await ctx.db.mutations.add(mutation);
	ctx.mutations.push({ ...mutation });
	return mutation.id;
}

/** Queues an image upload in the same transaction as the change that uses it. */
async function queueImage(
	ctx: Context,
	image: QueuedImage | undefined,
): Promise<string | undefined> {
	if (!image) return undefined;
	const fileId = newId();
	const upload = newMutation(ctx, {
		entity: "file",
		op: "create",
		entityId: fileId,
		novelId: null,
		patch: { name: image.name, type: image.type, size: image.blob.size },
	});
	await append(ctx, upload);
	await ctx.db.files.put({
		id: fileId,
		mutationId: upload.id,
		blob: image.blob,
		name: image.name,
		type: image.type,
		size: image.blob.size,
		createdAt: ctx.now,
	});
	return fileId;
}

/**
 * Folds a change into the entity's newest mutation when that one is still
 * unsent (`pending`), following the coalescing table; otherwise appends it
 * behind the tail. Returns the mutation ID, or null when nothing is left.
 */
async function coalesceOrAppend(
	ctx: Context,
	next: Mutation,
): Promise<string | null> {
	const tail = tailOf(ctx.mutations, next.entityId);
	if (!tail || tail.status !== "pending" || tail.seq === undefined)
		return append(ctx, next);
	const { db } = ctx;

	if (tail.op === "create" && next.op === "update") {
		const patch = { ...tail.patch, ...next.patch };
		if (tail.patch.imageId !== patch.imageId)
			await dropOrphanFileAfter(ctx, tail.patch.imageId, patch.imageId);
		await db.mutations.update(tail.seq, {
			patch,
			dependsOn: [...new Set([...tail.dependsOn, ...next.dependsOn])],
			updatedAt: ctx.now,
		});
		return tail.id;
	}
	if (tail.op === "create" && next.op === "delete") {
		// Never sent: both go, with the unsent changes of rows created under it.
		const dependants = dependantsOf(ctx.mutations, tail.entityId);
		await removeMutations(db, [tail, ...dependants]);
		await dropOrphanFile(
			db,
			tail.patch.imageId,
			ctx.mutations.filter((mutation) => mutation.id !== tail.id),
		);
		return null;
	}
	if (tail.op === "update" && next.op === "update") {
		const patch: Row = { ...tail.patch, ...next.patch };
		const base: Row = { ...next.base, ...tail.base };
		for (const field of Object.keys(patch)) {
			if (field in base && sameValue(patch[field], base[field])) {
				delete patch[field];
				delete base[field];
			}
		}
		if (tail.patch.imageId !== next.patch.imageId && "imageId" in next.patch) {
			await dropOrphanFileAfter(ctx, tail.patch.imageId, next.patch.imageId);
		}
		if (!Object.keys(patch).length) {
			await removeMutations(db, [tail]);
			return null;
		}
		await db.mutations.update(tail.seq, {
			patch,
			base,
			dependsOn: [...new Set([...tail.dependsOn, ...next.dependsOn])],
			updatedAt: ctx.now,
		});
		return tail.id;
	}
	if (tail.op === "update" && next.op === "delete") {
		await db.mutations.update(tail.seq, {
			op: "delete",
			patch: {},
			base: undefined,
			baseUpdatedAt: undefined,
			updatedAt: ctx.now,
		});
		await dropOrphanFile(
			db,
			tail.patch.imageId,
			ctx.mutations.filter((mutation) => mutation.id !== tail.id),
		);
		return tail.id;
	}
	return append(ctx, next);
}

/** Replacing a queued, unsent image drops the older upload and its blob. */
async function dropOrphanFileAfter(
	ctx: Context,
	previous: unknown,
	current: unknown,
): Promise<void> {
	if (previous === current) return;
	const remaining = ctx.mutations.map((mutation) =>
		mutation.patch.imageId === previous
			? { ...mutation, patch: { ...mutation.patch, imageId: current } }
			: mutation,
	);
	await dropOrphanFile(ctx.db, previous, remaining);
}

function assert(condition: boolean, error: () => Error): asserts condition {
	if (!condition) throw error();
}

function validate(code: ValidationCode | null): void {
	if (code) throw new ValidationFailed(code);
}

async function enqueueKeyword(
	ctx: Context,
	input: Extract<EnqueueInput, { entity: "keyword" }>,
): Promise<EnqueueResult> {
	if (input.op === "create") {
		assert(canCreate(ctx.user), () => new PermissionDenied());
		const { view } = await readViews(ctx, input.novelId);
		const names = {
			nameAr: cleanText(input.values.nameAr) ?? null,
			nameEn: cleanText(input.values.nameEn) ?? null,
		};
		validate(checkKeywordNames(names, view?.keywords ?? []));
		const entityId = newId();
		const versionId = newId();
		const fileId = await queueImage(ctx, input.image);
		const patch = defined({
			novelId: input.novelId,
			...names,
			matchingType: input.values.matchingType ?? "FULL",
			categoryId: input.values.categoryId,
			natureId: input.values.natureId,
			description: cleanText(input.values.description) ?? null,
			imageId: fileId ?? input.values.imageId ?? null,
			versionId,
		});
		const mutationId = await append(
			ctx,
			newMutation(ctx, {
				entity: "keyword",
				op: "create",
				entityId,
				novelId: input.novelId,
				patch,
				dependsOn: unconfirmedDependencies(ctx.mutations, [
					input.values.categoryId,
					input.values.natureId,
					patch.imageId as string,
				]),
			}),
		);
		await bumpChangeCounter(ctx.db, [input.novelId]);
		return { entityId, mutationId, versionId };
	}

	const novelId = await locateNovel(ctx, "keyword", input.id);
	const { view } = await readViews(ctx, novelId);
	const keyword = view?.keywords.find((item) => item.id === input.id);

	if (input.op === "delete") {
		if (!keyword || !novelId) return { entityId: input.id, mutationId: null };
		assert(canDeleteKeyword(ctx.user, keyword), () => new PermissionDenied());
		// The delete wins: unsent changes to its aliases and versions go with it.
		const children = ctx.mutations.filter(
			(mutation) =>
				mutation.parentId === input.id && mutation.status === "pending",
		);
		await removeMutations(ctx.db, children);
		const remaining = ctx.mutations.filter(
			(mutation) => !children.includes(mutation),
		);
		ctx.mutations.splice(0, ctx.mutations.length, ...remaining);
		const mutationId = await coalesceOrAppend(
			ctx,
			newMutation(ctx, {
				entity: "keyword",
				op: "delete",
				entityId: input.id,
				novelId,
				patch: {},
			}),
		);
		await bumpChangeCounter(ctx.db, [novelId]);
		return { entityId: input.id, mutationId };
	}

	if (!keyword || !novelId) throw new ValidationFailed("NOT_FOUND");
	assert(canEditKeyword(ctx.user, keyword), () => new PermissionDenied());
	const changes = defined({
		nameAr: cleanText(input.changes.nameAr),
		nameEn: cleanText(input.changes.nameEn),
		matchingType: input.changes.matchingType,
	}) as Partial<KeywordFields>;
	const { patch, base } = diffChanges(changes, input.seen, keyword);
	if (!Object.keys(patch).length)
		return { entityId: input.id, mutationId: null };
	validate(
		checkKeywordNames(
			{ ...keyword, ...patch } as KeywordFields,
			view?.keywords ?? [],
			input.id,
		),
	);
	const mutationId = await coalesceOrAppend(
		ctx,
		newMutation(ctx, {
			entity: "keyword",
			op: "update",
			entityId: input.id,
			novelId,
			patch,
			base,
			baseUpdatedAt: input.seenUpdatedAt ?? String(keyword.updatedAt),
		}),
	);
	await bumpChangeCounter(ctx.db, [novelId]);
	return { entityId: input.id, mutationId };
}

const ALIAS_FIELDS = [
	"nameAr",
	"nameEn",
	"description",
	"matchingType",
	"overrideStyle",
	"categoryId",
	"natureId",
	"imageId",
] as const;

function aliasValues(values: Partial<AliasValues>): Row {
	return defined({
		nameAr: cleanText(values.nameAr),
		nameEn: cleanText(values.nameEn),
		description: cleanText(values.description),
		matchingType: values.matchingType,
		overrideStyle: values.overrideStyle,
		categoryId: values.categoryId,
		natureId: values.natureId,
		imageId: values.imageId,
	});
}

async function enqueueAlias(
	ctx: Context,
	input: Extract<EnqueueInput, { entity: "keywordAlias" }>,
): Promise<EnqueueResult> {
	if (input.op === "create") {
		const novelId = await locateNovel(ctx, "keyword", input.keywordId);
		const { view } = await readViews(ctx, novelId);
		const keyword = view?.keywords.find((item) => item.id === input.keywordId);
		if (!keyword || !novelId) throw new ValidationFailed("PARENT_NOT_FOUND");
		assert(canCreate(ctx.user), () => new PermissionDenied());
		const values = aliasValues(input.values);
		validate(checkAliasNames(values, keyword.aliases));
		const fileId = await queueImage(ctx, input.image);
		const entityId = newId();
		const patch = {
			keywordId: input.keywordId,
			nameAr: null,
			nameEn: null,
			description: null,
			matchingType: "FULL",
			overrideStyle: false,
			categoryId: null,
			natureId: null,
			imageId: null,
			...values,
			...(fileId ? { imageId: fileId } : {}),
		};
		const mutationId = await append(
			ctx,
			newMutation(ctx, {
				entity: "keywordAlias",
				op: "create",
				entityId,
				novelId,
				parentId: input.keywordId,
				patch,
				dependsOn: unconfirmedDependencies(ctx.mutations, [
					input.keywordId,
					patch.categoryId as string | null,
					patch.natureId as string | null,
					patch.imageId as string | null,
				]),
			}),
		);
		await bumpChangeCounter(ctx.db, [novelId]);
		return { entityId, mutationId };
	}

	const novelId = await locateNovel(ctx, "keywordAlias", input.id);
	const { view } = await readViews(ctx, novelId);
	const found = view ? findAlias(view, input.id) : undefined;

	if (input.op === "delete") {
		if (!found || !novelId) return { entityId: input.id, mutationId: null };
		assert(
			canDeleteAlias(ctx.user, found.alias, found.keyword),
			() => new PermissionDenied(),
		);
		const mutationId = await coalesceOrAppend(
			ctx,
			newMutation(ctx, {
				entity: "keywordAlias",
				op: "delete",
				entityId: input.id,
				novelId,
				parentId: found.keyword.id,
				patch: {},
			}),
		);
		await bumpChangeCounter(ctx.db, [novelId]);
		return { entityId: input.id, mutationId };
	}

	if (!found || !novelId) throw new ValidationFailed("NOT_FOUND");
	assert(
		canEditAlias(ctx.user, found.alias, found.keyword),
		() => new PermissionDenied(),
	);
	const fileId = await queueImage(ctx, input.image);
	const changes = aliasValues({
		...input.changes,
		...(fileId ? { imageId: fileId } : {}),
	});
	const { patch, base } = diffChanges(
		changes,
		input.seen as Row | undefined,
		found.alias,
	);
	if (!Object.keys(patch).length)
		return { entityId: input.id, mutationId: null };
	validate(
		checkAliasNames(
			{ ...found.alias, ...patch } as AliasValues,
			found.keyword.aliases,
			input.id,
		),
	);
	const mutationId = await coalesceOrAppend(
		ctx,
		newMutation(ctx, {
			entity: "keywordAlias",
			op: "update",
			entityId: input.id,
			novelId,
			parentId: found.keyword.id,
			patch,
			base,
			baseUpdatedAt: input.seenUpdatedAt ?? String(found.alias.updatedAt),
			dependsOn: unconfirmedDependencies(ctx.mutations, [
				patch.categoryId as string,
				patch.natureId as string,
				patch.imageId as string,
			]),
		}),
	);
	await bumpChangeCounter(ctx.db, [novelId]);
	return { entityId: input.id, mutationId };
}

const BASE_VERSION_FIELDS = [
	"description",
	"categoryId",
	"natureId",
	"imageId",
] as const;

function versionValues(
	values: Partial<VersionValues>,
	moderator: boolean,
): Row {
	return defined({
		description: cleanText(values.description),
		categoryId: values.categoryId,
		natureId: values.natureId,
		imageId: values.imageId,
		...(moderator
			? {
					startingChapter: values.startingChapter,
					endingChapter: values.endingChapter,
				}
			: {}),
	});
}

async function enqueueVersion(
	ctx: Context,
	input: Extract<EnqueueInput, { entity: "keywordVersion" }>,
): Promise<EnqueueResult> {
	if (input.op === "create") {
		const novelId = await locateNovel(ctx, "keyword", input.keywordId);
		const { view } = await readViews(ctx, novelId);
		const keyword = view?.keywords.find((item) => item.id === input.keywordId);
		if (!keyword || !novelId) throw new ValidationFailed("PARENT_NOT_FOUND");
		assert(canCreate(ctx.user), () => new PermissionDenied());
		validate(
			checkVersionCreate(input.values, keyword.versions, ctx.actor.moderator),
		);
		const fileId = await queueImage(ctx, input.image);
		const entityId = newId();
		const patch = defined({
			keywordId: input.keywordId,
			description: cleanText(input.values.description) ?? null,
			categoryId: input.values.categoryId ?? undefined,
			natureId: input.values.natureId ?? undefined,
			imageId: fileId ?? input.values.imageId ?? null,
			...(ctx.actor.moderator
				? {
						startingChapter:
							input.values.startingChapter ?? input.values.currentChapter ?? 0,
						endingChapter: input.values.endingChapter ?? null,
					}
				: { currentChapter: input.values.currentChapter }),
		});
		const mutationId = await append(
			ctx,
			newMutation(ctx, {
				entity: "keywordVersion",
				op: "create",
				entityId,
				novelId,
				parentId: input.keywordId,
				patch,
				dependsOn: unconfirmedDependencies(ctx.mutations, [
					input.keywordId,
					patch.categoryId as string,
					patch.natureId as string,
					patch.imageId as string,
				]),
			}),
		);
		await bumpChangeCounter(ctx.db, [novelId]);
		return { entityId, mutationId };
	}

	const novelId = await locateNovel(ctx, "keywordVersion", input.id);
	const { view } = await readViews(ctx, novelId);
	const found = view ? findVersion(view, input.id) : undefined;

	if (input.op === "delete") {
		if (!found || !novelId) return { entityId: input.id, mutationId: null };
		assert(
			canDeleteVersion(ctx.user, found.version, found.keyword),
			() => new PermissionDenied(),
		);
		validate(checkVersionDelete(input.id, found.keyword.versions));
		const mutationId = await coalesceOrAppend(
			ctx,
			newMutation(ctx, {
				entity: "keywordVersion",
				op: "delete",
				entityId: input.id,
				novelId,
				parentId: found.keyword.id,
				patch: {},
			}),
		);
		await bumpChangeCounter(ctx.db, [novelId]);
		return { entityId: input.id, mutationId };
	}

	if (!found || !novelId) throw new ValidationFailed("NOT_FOUND");
	assert(
		canEditVersion(ctx.user, found.version, found.keyword),
		() => new PermissionDenied(),
	);
	const fileId = await queueImage(ctx, input.image);
	const changes = versionValues(
		{ ...input.changes, ...(fileId ? { imageId: fileId } : {}) },
		ctx.actor.moderator,
	);
	const { patch, base } = diffChanges(
		changes,
		input.seen as Row | undefined,
		found.version,
	);
	if (!Object.keys(patch).length)
		return { entityId: input.id, mutationId: null };

	// Editing the base version of an unsent keyword folds into that keyword's create.
	const keywordCreate = ctx.mutations.find(
		(mutation) =>
			mutation.entity === "keyword" &&
			mutation.op === "create" &&
			mutation.patch.versionId === input.id,
	);
	if (keywordCreate?.status === "pending" && keywordCreate.seq !== undefined) {
		const folded = Object.fromEntries(
			Object.entries(patch).filter(([field]) =>
				(BASE_VERSION_FIELDS as readonly string[]).includes(field),
			),
		);
		if (keywordCreate.patch.imageId !== folded.imageId && "imageId" in folded) {
			await dropOrphanFileAfter(
				ctx,
				keywordCreate.patch.imageId,
				folded.imageId,
			);
		}
		await ctx.db.mutations.update(keywordCreate.seq, {
			patch: { ...keywordCreate.patch, ...folded },
			dependsOn: [
				...new Set([
					...keywordCreate.dependsOn,
					...unconfirmedDependencies(ctx.mutations, [
						folded.categoryId as string,
						folded.natureId as string,
						folded.imageId as string,
					]),
				]),
			],
			updatedAt: ctx.now,
		});
		await bumpChangeCounter(ctx.db, [novelId]);
		return { entityId: input.id, mutationId: keywordCreate.id };
	}

	const mutationId = await coalesceOrAppend(
		ctx,
		newMutation(ctx, {
			entity: "keywordVersion",
			op: "update",
			entityId: input.id,
			novelId,
			parentId: found.keyword.id,
			patch,
			base,
			baseUpdatedAt: input.seenUpdatedAt ?? String(found.version.updatedAt),
			dependsOn: unconfirmedDependencies(ctx.mutations, [
				keywordCreate ? found.keyword.id : undefined,
				patch.categoryId as string,
				patch.natureId as string,
				patch.imageId as string,
			]),
		}),
	);
	await bumpChangeCounter(ctx.db, [novelId]);
	return { entityId: input.id, mutationId };
}

async function enqueueReplacement(
	ctx: Context,
	input: Extract<EnqueueInput, { entity: "replacement" }>,
): Promise<EnqueueResult> {
	if (input.op === "create") {
		assert(canCreate(ctx.user), () => new PermissionDenied());
		const { view } = await readViews(ctx, input.novelId);
		const values = {
			from: input.values.from.trim(),
			to: input.values.to.trim(),
		};
		validate(checkReplacement(values, view?.replacements ?? []));
		const entityId = newId();
		const mutationId = await append(
			ctx,
			newMutation(ctx, {
				entity: "replacement",
				op: "create",
				entityId,
				novelId: input.novelId,
				patch: {
					novelId: input.novelId,
					...values,
					matchingType: input.values.matchingType ?? "FULL",
				},
			}),
		);
		await bumpChangeCounter(ctx.db, [input.novelId]);
		return { entityId, mutationId };
	}

	const novelId = await locateNovel(ctx, "replacement", input.id);
	const { view } = await readViews(ctx, novelId);
	const replacement: ReplacementRow | undefined = view?.replacements.find(
		(item) => item.id === input.id,
	);

	if (input.op === "delete") {
		if (!replacement || !novelId)
			return { entityId: input.id, mutationId: null };
		assert(
			canDeleteReplacement(ctx.user, replacement),
			() => new PermissionDenied(),
		);
		const mutationId = await coalesceOrAppend(
			ctx,
			newMutation(ctx, {
				entity: "replacement",
				op: "delete",
				entityId: input.id,
				novelId,
				patch: {},
			}),
		);
		await bumpChangeCounter(ctx.db, [novelId]);
		return { entityId: input.id, mutationId };
	}

	if (!replacement || !novelId) throw new ValidationFailed("NOT_FOUND");
	assert(
		canEditReplacement(ctx.user, replacement),
		() => new PermissionDenied(),
	);
	const changes = defined({
		from: input.changes.from?.trim(),
		to: input.changes.to?.trim(),
		matchingType: input.changes.matchingType,
	});
	const { patch, base } = diffChanges(changes, input.seen, replacement);
	if (!Object.keys(patch).length)
		return { entityId: input.id, mutationId: null };
	validate(
		checkReplacement(
			{ ...replacement, ...patch } as ReplacementValues,
			view?.replacements ?? [],
			input.id,
		),
	);
	const mutationId = await coalesceOrAppend(
		ctx,
		newMutation(ctx, {
			entity: "replacement",
			op: "update",
			entityId: input.id,
			novelId,
			patch,
			base,
			baseUpdatedAt: input.seenUpdatedAt ?? String(replacement.updatedAt),
		}),
	);
	await bumpChangeCounter(ctx.db, [novelId]);
	return { entityId: input.id, mutationId };
}

async function enqueueLookup(
	ctx: Context,
	input: Extract<EnqueueInput, { entity: "keywordCategory" | "keywordNature" }>,
): Promise<EnqueueResult> {
	assert(canManageLookups(ctx.user), () => new PermissionDenied());
	const { lookups } = await readViews(ctx, null);
	const rows =
		input.entity === "keywordCategory" ? lookups.categories : lookups.natures;

	if (input.op === "create") {
		const values = {
			nameAr: cleanText(input.values.nameAr) ?? null,
			nameEn: cleanText(input.values.nameEn) ?? null,
			color: input.values.color,
			description: cleanText(input.values.description) ?? null,
		};
		validate(checkLookupNames(values, rows));
		const entityId = newId();
		const mutationId = await append(
			ctx,
			newMutation(ctx, {
				entity: input.entity,
				op: "create",
				entityId,
				novelId: null,
				patch: values,
			}),
		);
		await bumpChangeCounter(ctx.db);
		return { entityId, mutationId };
	}

	const row = rows.find((item) => item.id === input.id);
	if (input.op === "delete") {
		if (!row) return { entityId: input.id, mutationId: null };
		const [versions, aliases] = await Promise.all([
			ctx.db.keywordVersions.toArray(),
			ctx.db.keywordAliases.toArray(),
		]);
		const field =
			input.entity === "keywordCategory" ? "categoryId" : "natureId";
		const pendingUse = ctx.mutations.some(
			(mutation) =>
				mutation.op !== "delete" && mutation.patch[field] === input.id,
		);
		validate(
			pendingUse
				? input.entity === "keywordCategory"
					? "CATEGORY_IN_USE"
					: "NATURE_IN_USE"
				: null,
		);
		validate(checkLookupDelete(input.entity, input.id, { versions, aliases }));
		const mutationId = await coalesceOrAppend(
			ctx,
			newMutation(ctx, {
				entity: input.entity,
				op: "delete",
				entityId: input.id,
				novelId: null,
				patch: {},
			}),
		);
		await bumpChangeCounter(ctx.db);
		return { entityId: input.id, mutationId };
	}

	if (!row) throw new ValidationFailed("NOT_FOUND");
	const changes = defined({
		nameAr: cleanText(input.changes.nameAr),
		nameEn: cleanText(input.changes.nameEn),
		color: input.changes.color,
		description: cleanText(input.changes.description),
	});
	const { patch, base } = diffChanges(changes, input.seen, row);
	if (!Object.keys(patch).length)
		return { entityId: input.id, mutationId: null };
	validate(
		checkLookupNames({ ...row, ...patch } as LookupValues, rows, input.id),
	);
	const mutationId = await coalesceOrAppend(
		ctx,
		newMutation(ctx, {
			entity: input.entity,
			op: "update",
			entityId: input.id,
			novelId: null,
			patch,
			base,
			baseUpdatedAt: input.seenUpdatedAt ?? String(row.updatedAt),
		}),
	);
	await bumpChangeCounter(ctx.db);
	return { entityId: input.id, mutationId };
}

async function queuedImageBytes(db: StoryLensDatabase): Promise<number> {
	let total = 0;
	await db.files.each((file) => {
		total += file.size;
	});
	return total;
}

function imageOf(input: EnqueueInput): QueuedImage | undefined {
	return "image" in input ? input.image : undefined;
}

/**
 * The only way UI code changes a syncable entity. In one read-write transaction
 * it checks the account and permissions (D12), validates against the server's
 * rules, keeps only the changed fields, folds the change into an unsent one for
 * the same entity, records its dependencies and writes it to the outbox. Once
 * it returns, the change survives the popup closing, a worker restart and going
 * offline; the runner sends it.
 */
export async function enqueue(
	input: EnqueueInput,
	options: EnqueueOptions = {},
): Promise<EnqueueResult> {
	const db = options.db ?? offlineDb();
	const user =
		options.user === undefined ? (await getStoredAuth()).user : options.user;
	if (!user || user.isGuest) throw new NotSignedIn();
	const image = imageOf(input);
	if (image && image.blob.size > MAX_IMAGE_BYTES)
		throw new ValidationFailed("IMAGE_TOO_LARGE");

	const result = await db.transaction("rw", allTables(db), async () => {
		const ctx: Context = {
			db,
			user,
			mutations: await readUserMutations(db, user.id),
			now: options.now ?? Date.now(),
			actor: { moderator: isModerator(user) },
		};
		if (input.entity === "keyword") return enqueueKeyword(ctx, input);
		if (input.entity === "keywordAlias") return enqueueAlias(ctx, input);
		if (input.entity === "keywordVersion") return enqueueVersion(ctx, input);
		if (input.entity === "replacement") return enqueueReplacement(ctx, input);
		return enqueueLookup(ctx, input);
	});

	if (image && (await queuedImageBytes(db)) > QUEUED_IMAGES_WARNING_BYTES) {
		return { ...result, warning: "QUEUED_IMAGES_LARGE" };
	}
	return result;
}

/**
 * What deleting an entity would also drop: the unsent changes of rows created
 * under it. Forms confirm with this list before deleting a row created locally.
 */
export async function planDelete(
	entityId: string,
	options: { db?: StoryLensDatabase; userId?: string } = {},
): Promise<Mutation[]> {
	const db = options.db ?? offlineDb();
	const userId = options.userId ?? (await getStoredAuth()).user?.id;
	const mutations = await readUserMutations(db, userId);
	const tail = tailOf(mutations, entityId);
	const children = mutations.filter(
		(mutation) =>
			mutation.parentId === entityId && mutation.status === "pending",
	);
	if (tail?.op === "create" && tail.status === "pending") {
		return [
			...new Map(
				[...dependantsOf(mutations, entityId), ...children].map((mutation) => [
					mutation.id,
					mutation,
				]),
			).values(),
		];
	}
	return children;
}

// ---------------------------------------------------------------------------
// Resolution actions (phase 7 builds the UI on them)
// ---------------------------------------------------------------------------

export type Resolution =
	/** Per conflicting field: keep the reader's value or take the server's. */
	| { kind: "fields"; choices: Record<string, "mine" | "theirs"> }
	| { kind: "keepAllMine" }
	| { kind: "useAllTheirs" }
	/** Replaces the change (a create's full body, an update's changed fields) and sends it again. */
	| { kind: "edit"; patch: Record<string, unknown> }
	/** An update of a row deleted on the server becomes a create under a new ID. */
	| { kind: "createAgain" };

/** Removes a mutation and, by default, the unsent changes that depend on it. */
export async function discardMutation(
	mutationId: string,
	options: { withDependants?: boolean; db?: StoryLensDatabase } = {},
): Promise<Mutation[]> {
	const db = options.db ?? offlineDb();
	return db.transaction("rw", allTables(db), async () => {
		const mutation = await db.mutations.where("id").equals(mutationId).first();
		if (!mutation) return [];
		const mutations = await readUserMutations(db, mutation.userId);
		const dependants =
			options.withDependants === false || mutation.op !== "create"
				? []
				: dependantsOf(mutations, mutation.entityId);
		// A discarded upload leaves the changes that used it without the image.
		if (mutation.entity === "file") {
			for (const user of mutations.filter(
				(item) =>
					item.patch.imageId === mutation.entityId && item.seq !== undefined,
			)) {
				const { imageId: _removed, ...patch } = user.patch;
				await db.mutations.update(user.seq as number, {
					patch: user.op === "create" ? { ...patch, imageId: null } : patch,
					dependsOn: user.dependsOn.filter((id) => id !== mutation.entityId),
				});
			}
		}
		const removed = [
			mutation,
			...dependants.filter((item) => item.entity !== "file"),
		];
		await removeMutations(db, removed);
		const left = mutations.filter(
			(item) => !removed.some((gone) => gone.id === item.id),
		);
		await dropOrphanFile(db, mutation.patch.imageId, left);
		await bumpChangeCounter(
			db,
			removed.map((item) => item.novelId),
		);
		return removed;
	});
}

function lastKnownValues(mutation: Mutation): Row {
	return { ...(mutation.conflict?.server ?? {}), ...mutation.patch };
}

function createAgainPatch(mutation: Mutation): Row | null {
	const row = lastKnownValues(mutation);
	const base = (mutation.conflict?.server?.baseVersion ?? {}) as Row;
	switch (mutation.entity) {
		case "keyword":
			if (
				!(base.categoryId ?? row.categoryId) ||
				!(base.natureId ?? row.natureId)
			)
				return null;
			return {
				novelId: mutation.novelId,
				nameAr: row.nameAr ?? null,
				nameEn: row.nameEn ?? null,
				matchingType: row.matchingType ?? "FULL",
				categoryId: base.categoryId ?? row.categoryId,
				natureId: base.natureId ?? row.natureId,
				description: base.description ?? row.description ?? null,
				imageId: base.imageId ?? row.imageId ?? null,
				versionId: newId(),
			};
		case "keywordAlias":
			return defined({
				keywordId: row.keywordId ?? mutation.parentId,
				...Object.fromEntries(ALIAS_FIELDS.map((field) => [field, row[field]])),
			});
		case "keywordVersion":
			return defined({
				keywordId: row.keywordId ?? mutation.parentId,
				description: row.description ?? null,
				categoryId: row.categoryId ?? undefined,
				natureId: row.natureId ?? undefined,
				imageId: row.imageId ?? null,
				...(mutation.actor.moderator
					? {
							startingChapter: row.startingChapter,
							endingChapter: row.endingChapter ?? null,
						}
					: { currentChapter: row.startingChapter }),
			});
		case "replacement":
			return {
				novelId: mutation.novelId,
				from: row.from,
				to: row.to,
				matchingType: row.matchingType ?? "FULL",
			};
		case "keywordCategory":
		case "keywordNature":
			return {
				nameAr: row.nameAr ?? null,
				nameEn: row.nameEn ?? null,
				color: row.color,
				description: row.description ?? null,
			};
		default:
			return null;
	}
}

/**
 * Applies the reader's decision on a mutation that needs attention: it goes
 * back to `pending` (sent on the next run) or, when nothing is left to send,
 * leaves the outbox.
 */
export async function applyResolution(
	mutationId: string,
	resolution: Resolution,
	options: { db?: StoryLensDatabase; now?: number } = {},
): Promise<"pending" | "removed"> {
	const db = options.db ?? offlineDb();
	const now = options.now ?? Date.now();
	return db.transaction("rw", allTables(db), async () => {
		const mutation = await db.mutations.where("id").equals(mutationId).first();
		if (!mutation || mutation.seq === undefined) return "removed";
		const reset: Partial<Mutation> = {
			status: "pending",
			conflict: undefined,
			lastError: undefined,
			attempts: 0,
			nextAttemptAt: now,
			updatedAt: now,
		};

		if (resolution.kind === "edit") {
			await db.mutations.update(mutation.seq, {
				...reset,
				// Edited fields replace their values; untouched ones stay.
				patch: { ...mutation.patch, ...resolution.patch },
			});
			await bumpChangeCounter(db, [mutation.novelId]);
			return "pending";
		}

		if (resolution.kind === "createAgain") {
			const patch = createAgainPatch(mutation);
			if (!patch) throw new ValidationFailed("PARENT_NOT_FOUND");
			const op: MutationOp = "create";
			await db.mutations.update(mutation.seq, {
				...reset,
				op,
				entityId: newId(),
				patch,
				base: undefined,
				baseUpdatedAt: undefined,
			});
			await bumpChangeCounter(db, [mutation.novelId]);
			return "pending";
		}

		const fields = mutation.conflict?.fields ?? [];
		const choices: Record<string, "mine" | "theirs"> =
			resolution.kind === "fields"
				? resolution.choices
				: Object.fromEntries(
						fields.map((item) => [
							item.field,
							resolution.kind === "keepAllMine" ? "mine" : "theirs",
						]),
					);
		const patch: Row = { ...mutation.patch };
		const base: Row = { ...mutation.base };
		for (const item of fields) {
			if (choices[item.field] === "theirs") {
				delete patch[item.field];
				delete base[item.field];
			} else {
				base[item.field] = item.theirs ?? null;
			}
		}
		if (!Object.keys(patch).length) {
			await removeMutations(db, [mutation]);
			await bumpChangeCounter(db, [mutation.novelId]);
			return "removed";
		}
		const serverUpdatedAt = mutation.conflict?.server?.updatedAt;
		await db.mutations.update(mutation.seq, {
			...reset,
			patch,
			base,
			baseUpdatedAt:
				typeof serverUpdatedAt === "string"
					? serverUpdatedAt
					: mutation.baseUpdatedAt,
		});
		await bumpChangeCounter(db, [mutation.novelId]);
		return "pending";
	});
}

/** The account's mutations (all statuses) for status pages and counts. */
export async function listMutations(
	userId?: string | null,
	db: StoryLensDatabase = offlineDb(),
): Promise<Mutation[]> {
	const all = userId
		? await db.mutations.where("userId").equals(userId).toArray()
		: await db.mutations.toArray();
	return all.sort(bySeq);
}

/** Unresolved changes of the account: everything still in the outbox. */
export async function countUnresolved(
	userId: string | null | undefined,
	db: StoryLensDatabase = offlineDb(),
): Promise<number> {
	if (!userId) return 0;
	return db.mutations.where("userId").equals(userId).count();
}

/** Deletes queued image blobs whose upload is no longer in the outbox (run at worker start). */
export async function sweepOrphanFiles(
	db: StoryLensDatabase = offlineDb(),
): Promise<number> {
	return db.transaction("rw", db.files, db.mutations, async () => {
		const ids = new Set(
			(await db.mutations.toArray()).map((mutation) => mutation.id),
		);
		const orphans = (await db.files.toArray()).filter(
			(file) => !ids.has(file.mutationId),
		);
		await db.files.bulkDelete(orphans.map((file) => file.id));
		return orphans.length;
	});
}
