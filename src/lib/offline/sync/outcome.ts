import type { EntityTable } from "dexie";
import type { StoryLensDatabase } from "@/lib/offline/db";
import { bumpChangeCounter, markPullDue } from "@/lib/offline/meta";
import { merge, sameValue } from "@/lib/offline/rules/merge";
import {
	removeRows,
	splitKeywords,
	upsertRows,
	withBaseVersion,
} from "@/lib/offline/snapshot";
import type {
	AliasRow,
	AssembledKeyword,
	CategoryRow,
	ConflictKind,
	Mutation,
	NatureRow,
	ReplacementRow,
	VersionRow,
} from "@/lib/offline/types";
import type { Outcome } from "./classify";
import { backoffDelay } from "./scheduler";

/** Automatic merges allowed per mutation per run, so two active clients cannot ping-pong. */
export const MAX_MERGES_PER_RUN = 3;
/** After this many transient failures the status warns, but retries continue. */
export const TROUBLE_ATTEMPTS = 8;

export type AppliedOutcome = {
	/** How the run summary counts it. */
	result: "sent" | "merged" | "conflict" | "rejected" | "transient" | "paused";
	/** Stops the push loop: offline, signed out, or an update is required. */
	stop?: "network" | "auth" | "upgrade";
	/** Keyword whose versions the server changed (auto-close); re-read them. */
	refreshVersionsOf?: string;
	/** Entered `conflict` or `rejected`, for analytics. */
	attention?: ConflictKind;
};

type Row = Record<string, unknown>;

/** Writes a server row of the mutation's entity into the snapshot (later `updatedAt` wins). */
async function storeRow(
	db: StoryLensDatabase,
	mutation: Mutation,
	data: unknown,
): Promise<void> {
	if (!data || typeof data !== "object") return;
	const row = data as Row;
	switch (mutation.entity) {
		case "keyword": {
			const { keywords, aliases, versions } = splitKeywords([
				row as unknown as AssembledKeyword,
			]);
			await upsertRows(db.keywords, keywords);
			await upsertRows(db.keywordAliases, aliases);
			await upsertRows(db.keywordVersions, versions);
			return;
		}
		case "keywordAlias":
			return upsertRows(db.keywordAliases, [row as unknown as AliasRow]);
		case "keywordVersion":
			return upsertRows(db.keywordVersions, [row as unknown as VersionRow]);
		case "replacement":
			return upsertRows(db.replacements, [row as unknown as ReplacementRow]);
		case "keywordCategory":
			return upsertRows(
				db.keywordCategories as EntityTable<CategoryRow, "id">,
				[row as unknown as CategoryRow],
			);
		case "keywordNature":
			return upsertRows(db.keywordNatures as EntityTable<NatureRow, "id">, [
				row as unknown as NatureRow,
			]);
		default:
	}
}

/** The snapshot row being removed, kept on a `deleted` conflict for "create again". */
async function lastKnownRow(
	db: StoryLensDatabase,
	mutation: Mutation,
): Promise<Row | null> {
	switch (mutation.entity) {
		case "keyword": {
			const keyword = await db.keywords.get(mutation.entityId);
			if (!keyword) return null;
			const versions = await db.keywordVersions
				.where("keywordId")
				.equals(keyword.id)
				.toArray();
			return withBaseVersion(keyword, versions) as unknown as Row;
		}
		case "keywordAlias":
			return (
				((await db.keywordAliases.get(mutation.entityId)) as unknown as Row) ??
				null
			);
		case "keywordVersion":
			return (
				((await db.keywordVersions.get(mutation.entityId)) as unknown as Row) ??
				null
			);
		case "replacement":
			return (
				((await db.replacements.get(mutation.entityId)) as unknown as Row) ??
				null
			);
		case "keywordCategory":
			return (
				((await db.keywordCategories.get(
					mutation.entityId,
				)) as unknown as Row) ?? null
			);
		case "keywordNature":
			return (
				((await db.keywordNatures.get(mutation.entityId)) as unknown as Row) ??
				null
			);
		default:
			return null;
	}
}

/**
 * Later unsent updates of the entity were based on what the reader saw; when
 * that equals what the server now holds, they move onto its new `updatedAt`
 * instead of meeting a pointless 409.
 */
async function rebaseLater(
	db: StoryLensDatabase,
	mutation: Mutation,
	data: unknown,
): Promise<void> {
	if (!data || typeof data !== "object") return;
	const server = data as Row;
	const updatedAt = server.updatedAt;
	if (typeof updatedAt !== "string") return;
	const later = await db.mutations
		.where("entityId")
		.equals(mutation.entityId)
		.toArray();
	for (const next of later) {
		if (
			next.id === mutation.id ||
			next.op !== "update" ||
			next.status !== "pending" ||
			next.seq === undefined
		)
			continue;
		const base = next.base ?? {};
		if (
			Object.entries(base).every(([field, value]) =>
				sameValue(value, server[field]),
			)
		) {
			await db.mutations.update(next.seq, { baseUpdatedAt: updatedAt });
		}
	}
}

/** A deduplicated upload came back with another file's ID: point its users at it. */
async function adoptUploadedFile(
	db: StoryLensDatabase,
	mutation: Mutation,
	data: unknown,
): Promise<void> {
	await db.files.delete(mutation.entityId);
	const fileId =
		data && typeof data === "object" ? (data as Row).id : undefined;
	if (typeof fileId !== "string" || fileId === mutation.entityId) return;
	const users = await db.mutations
		.filter((item) => item.patch.imageId === mutation.entityId)
		.toArray();
	for (const user of users) {
		if (user.seq === undefined) continue;
		await db.mutations.update(user.seq, {
			patch: { ...user.patch, imageId: fileId },
			dependsOn: user.dependsOn.filter((id) => id !== mutation.entityId),
		});
	}
}

/** The row a mutation's translation link asked the server to merge into it. */
function absorbedTranslation(mutation: Mutation): string | undefined {
	const field =
		mutation.entity === "keyword"
			? "translationKeywordId"
			: mutation.entity === "keywordAlias"
				? "translationAliasId"
				: undefined;
	if (!field) return undefined;
	const value = mutation.patch[field];
	return typeof value === "string" ? value : undefined;
}

function errorOf(outcome: Outcome, now: number): Mutation["lastError"] {
	const message =
		"message" in outcome && outcome.message ? outcome.message : outcome.type;
	return {
		message,
		code: "code" in outcome ? outcome.code : undefined,
		at: now,
	};
}

/**
 * Applies a send outcome to the outbox and the snapshot in one transaction
 * (outcomes table). A mutation leaves the outbox only on server confirmation or
 * an idempotent equivalent (404 on delete, a merge with nothing left).
 */
export async function applyOutcome(
	db: StoryLensDatabase,
	mutation: Mutation,
	outcome: Outcome,
	{
		now = Date.now(),
		merges = new Map<string, number>(),
		random = Math.random,
	}: { now?: number; merges?: Map<string, number>; random?: () => number } = {},
): Promise<AppliedOutcome> {
	return db.transaction(
		"rw",
		[
			db.mutations,
			db.files,
			db.keywords,
			db.keywordAliases,
			db.keywordVersions,
			db.replacements,
			db.keywordCategories,
			db.keywordNatures,
			db.novelSync,
			db.syncMeta,
		],
		async (): Promise<AppliedOutcome> => {
			const stored = await db.mutations.where("id").equals(mutation.id).first();
			// Discarded while in flight: the reader's decision stands; keep the server's answer.
			if (!stored || stored.seq === undefined) {
				if (outcome.type === "success")
					await storeRow(db, mutation, outcome.data);
				return { result: "sent" };
			}
			const seq = stored.seq;
			const novelIds = [mutation.novelId];
			const finish = async (applied: AppliedOutcome) => {
				await bumpChangeCounter(db, novelIds);
				return applied;
			};
			const transient = async (
				retryAfterMs?: number,
				lastError = errorOf(outcome, now),
			) => {
				const attempts = stored.attempts + 1;
				await db.mutations.update(seq, {
					status: "pending",
					leaseUntil: undefined,
					attempts,
					nextAttemptAt: now + backoffDelay(attempts, retryAfterMs, random),
					lastError,
				});
			};

			switch (outcome.type) {
				case "success": {
					if (mutation.op === "delete")
						await removeRows(db, mutation.entity, [mutation.entityId]);
					else if (mutation.entity === "file")
						await adoptUploadedFile(db, mutation, outcome.data);
					else await storeRow(db, mutation, outcome.data);
					// A translation link merged another row into this one: the server
					// deleted it. Drop it after the answer, which already carries the
					// aliases that moved, and pull the novel for its replacements.
					const absorbed = absorbedTranslation(mutation);
					if (absorbed) {
						await removeRows(db, mutation.entity, [absorbed]);
						if (mutation.entity === "keyword" && mutation.novelId)
							await markPullDue(mutation.novelId, db);
					}
					await db.mutations.delete(seq);
					if (mutation.op !== "delete")
						await rebaseLater(db, mutation, outcome.data);
					if (
						mutation.entity === "replacement" &&
						mutation.novelId &&
						mutation.op !== "delete"
					) {
						// The server may have rewritten other rows' `to` (chain rewrite).
						await markPullDue(mutation.novelId, db);
					}
					const refreshVersionsOf =
						mutation.entity === "keywordVersion" && mutation.op === "create"
							? ((mutation.patch.keywordId as string | undefined) ??
								mutation.parentId)
							: undefined;
					return finish({ result: "sent", refreshVersionsOf });
				}
				case "alreadyDone":
					await removeRows(db, mutation.entity, [mutation.entityId]);
					await db.mutations.delete(seq);
					return finish({ result: "sent" });
				case "stale": {
					await storeRow(db, mutation, outcome.current);
					const merged = merge(stored.base, stored.patch, outcome.current);
					if (merged.deleted) break;
					if (merged.conflicts.length) {
						await db.mutations.update(seq, {
							status: "conflict",
							leaseUntil: undefined,
							conflict: {
								kind: "stale",
								server: outcome.current,
								fields: merged.conflicts,
							},
							lastError: errorOf(outcome, now),
						});
						return finish({ result: "conflict", attention: "stale" });
					}
					if (!Object.keys(merged.autoPatch).length) {
						// A lost response replayed: the server already has every field.
						await db.mutations.delete(seq);
						return finish({ result: "merged" });
					}
					const count = (merges.get(mutation.id) ?? 0) + 1;
					merges.set(mutation.id, count);
					const base = { ...merged.newBase };
					await db.mutations.update(seq, {
						patch: merged.autoPatch,
						base,
						baseUpdatedAt: merged.newBaseUpdatedAt ?? stored.baseUpdatedAt,
						status: "pending",
						leaseUntil: undefined,
						nextAttemptAt: now,
					});
					if (count > MAX_MERGES_PER_RUN) {
						await transient(undefined, {
							message: "Changed repeatedly on Story Lens; retrying later",
							at: now,
						});
						return finish({ result: "transient" });
					}
					return finish({ result: "merged" });
				}
				case "conflict": {
					let server = outcome.server ?? null;
					if (outcome.kind === "deleted") {
						server = (await lastKnownRow(db, mutation)) ?? server;
						await removeRows(db, mutation.entity, [mutation.entityId]);
					}
					if (outcome.kind === "parent-missing" && mutation.novelId)
						await markPullDue(mutation.novelId, db);
					await db.mutations.update(seq, {
						status: "conflict",
						leaseUntil: undefined,
						conflict: { kind: outcome.kind, server },
						lastError: errorOf(outcome, now),
					});
					return finish({ result: "conflict", attention: outcome.kind });
				}
				case "rejected":
					await db.mutations.update(seq, {
						status: "rejected",
						leaseUntil: undefined,
						conflict: {
							kind: outcome.kind,
							...(outcome.hint ? { hint: outcome.hint } : {}),
						},
						lastError: errorOf(outcome, now),
					});
					return finish({ result: "rejected", attention: outcome.kind });
				case "transient":
					await transient(outcome.retryAfterMs);
					return finish({
						result: "transient",
						stop: outcome.reason === "network" ? "network" : undefined,
					});
				case "auth":
				case "upgrade":
					// Not the change's fault: no attempt is counted.
					await db.mutations.update(seq, {
						status: "pending",
						leaseUntil: undefined,
					});
					return finish({ result: "paused", stop: outcome.type });
			}
			await db.mutations.update(seq, {
				status: "pending",
				leaseUntil: undefined,
			});
			return finish({ result: "transient" });
		},
	);
}

/** Inflight mutations whose lease ran out (the worker died mid-send) go back to pending. */
export async function recoverExpiredLeases(
	db: StoryLensDatabase,
	now = Date.now(),
): Promise<number> {
	return db.mutations
		.where("status")
		.equals("inflight")
		.filter((mutation) => (mutation.leaseUntil ?? 0) < now)
		.modify({ status: "pending", leaseUntil: undefined });
}

/** Marks a mutation in flight for `leaseMs`; false when it changed meanwhile. */
export async function leaseMutation(
	db: StoryLensDatabase,
	mutation: Mutation,
	now: number,
	leaseMs = 90_000,
): Promise<Mutation | undefined> {
	return db.transaction("rw", db.mutations, async () => {
		const current = await db.mutations.where("id").equals(mutation.id).first();
		if (!current || current.seq === undefined || current.status !== "pending")
			return undefined;
		await db.mutations.update(current.seq, {
			status: "inflight",
			leaseUntil: now + leaseMs,
		});
		return { ...current, status: "inflight", leaseUntil: now + leaseMs };
	});
}
