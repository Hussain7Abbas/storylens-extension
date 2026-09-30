import type { Mutation } from "@/lib/offline/types";

const bySeq = (left: Mutation, right: Mutation) =>
	(left.seq ?? 0) - (right.seq ?? 0);

/** Whether `entityId`'s create (or the keyword create that makes a base version) is still in the outbox. */
function createUnconfirmed(
	mutations: Mutation[],
	entityId: string,
	except: Mutation,
): boolean {
	return mutations.some(
		(mutation) =>
			mutation !== except &&
			mutation.op === "create" &&
			(mutation.entityId === entityId || mutation.patch.versionId === entityId),
	);
}

/**
 * The next mutation to send: the lowest `seq` among the account's mutations
 * that are `pending` and due, have no earlier mutation of the same entity that
 * cannot be sent now, and whose dependencies' creates are all confirmed. A
 * waiting or blocked entity never stops other entities from being sent.
 * `manual` (Sync now) treats waiting mutations as due; it never touches
 * `conflict` or `rejected` ones.
 */
export function pickNext(
	mutations: Mutation[],
	{
		userId,
		now,
		manual = false,
	}: { userId: string; now: number; manual?: boolean },
): Mutation | undefined {
	const blocked = new Set<string>();
	for (const mutation of [...mutations].sort(bySeq)) {
		if (mutation.userId !== userId) continue;
		if (blocked.has(mutation.entityId)) continue;
		const due =
			mutation.status === "pending" &&
			(manual || mutation.nextAttemptAt <= now);
		const waitsForDependency = mutation.dependsOn.some((id) =>
			createUnconfirmed(mutations, id, mutation),
		);
		if (!due || waitsForDependency) {
			blocked.add(mutation.entityId);
			continue;
		}
		return mutation;
	}
	return undefined;
}

/** The earliest time a waiting mutation of the account becomes due, for the retry alarm. */
export function nextWakeAt(
	mutations: Mutation[],
	{ userId, now }: { userId: string; now: number },
): number | undefined {
	let earliest: number | undefined;
	for (const mutation of mutations) {
		if (
			mutation.userId !== userId ||
			mutation.status !== "pending" ||
			mutation.nextAttemptAt <= now
		)
			continue;
		earliest =
			earliest === undefined
				? mutation.nextAttemptAt
				: Math.min(earliest, mutation.nextAttemptAt);
	}
	return earliest;
}

/** Backoff for transient failures: 5 s doubling to 15 min, ±20 % jitter, or `Retry-After` when longer. */
export function backoffDelay(
	attempts: number,
	retryAfterMs?: number,
	random: () => number = Math.random,
): number {
	const base = Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
	const jittered = base * (0.8 + random() * 0.4);
	return Math.max(jittered, retryAfterMs ?? 0);
}
