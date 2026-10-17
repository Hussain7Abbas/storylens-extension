import type { StoryLensDatabase } from "./db";
import { markPullDue } from "./meta";
import type { AliasRow, Mutation, VersionRow } from "./types";

export function lookupMigration(mutation: Mutation) {
	if (
		mutation.op !== "delete" ||
		(mutation.entity !== "keywordCategory" &&
			mutation.entity !== "keywordNature")
	)
		return null;
	const replacementId = mutation.patch.replacementId;
	return typeof replacementId === "string" &&
		replacementId !== mutation.entityId
		? {
				field:
					mutation.entity === "keywordCategory"
						? ("categoryId" as const)
						: ("natureId" as const),
				replacementId,
			}
		: null;
}

/** After the server commits, retain migrated cached links and late queued edits until fresh pulls. */
export async function adoptLookupMigration(
	db: StoryLensDatabase,
	mutation: Mutation,
): Promise<string[]> {
	const migration = lookupMigration(mutation);
	if (!migration) return [];
	const { field, replacementId } = migration;
	const keywordIds = new Set<string>();
	const migrateRow = (row: VersionRow | AliasRow): boolean | undefined => {
		if (row[field] !== mutation.entityId) return false;
		row[field] = replacementId;
		keywordIds.add(row.keywordId);
	};
	await db.keywordVersions.toCollection().modify(migrateRow);
	await db.keywordAliases.toCollection().modify(migrateRow);

	const novelIds = new Set<string>();
	for (const row of await db.keywords.bulkGet([...keywordIds]))
		if (row) novelIds.add(row.novelId);
	for (const queued of await db.mutations
		.where("userId")
		.equals(mutation.userId)
		.toArray()) {
		if (queued.seq === undefined || queued.id === mutation.id) continue;
		if (
			queued.patch[field] !== mutation.entityId &&
			queued.base?.[field] !== mutation.entityId
		)
			continue;
		await db.mutations.update(queued.seq, {
			patch:
				queued.patch[field] === mutation.entityId
					? { ...queued.patch, [field]: replacementId }
					: queued.patch,
			base:
				queued.base?.[field] === mutation.entityId
					? { ...queued.base, [field]: replacementId }
					: queued.base,
			dependsOn: [
				...new Set([
					...queued.dependsOn.filter((id) => id !== mutation.entityId),
					...((
						await db.mutations.where("entityId").equals(replacementId).toArray()
					).some((row) => row.op === "create")
						? [replacementId]
						: []),
				]),
			],
		});
		if (queued.novelId) novelIds.add(queued.novelId);
	}
	for (const id of novelIds) await markPullDue(id, db);
	return [...novelIds];
}
