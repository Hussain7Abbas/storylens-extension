import type { FieldConflict } from "@/lib/offline/types";

type Row = Record<string, unknown>;

function normalize(value: unknown): unknown {
	if (value === undefined || value === null) return null;
	if (typeof value === "string") {
		const trimmed = value.trim();
		// Optional text: null, undefined and "" all mean "empty".
		return trimmed === "" ? null : trimmed;
	}
	return value;
}

/**
 * Field equality for merges: text is compared trimmed, and null, undefined and
 * "" are the same empty value. Stored text is raw since the API stopped
 * HTML-escaping it (decision D11), so no decoding happens here.
 */
export function sameValue(left: unknown, right: unknown): boolean {
	return Object.is(normalize(left), normalize(right));
}

export type MergeResult =
	| { deleted: true }
	| {
			deleted: false;
			/** Fields still worth sending: the server does not have them yet. */
			autoPatch: Row;
			/** Fields both sides changed to different values. */
			conflicts: FieldConflict[];
			/** Base for the fields left in `autoPatch`: the server's values now. */
			newBase: Row;
			newBaseUpdatedAt: string | undefined;
	  };

/**
 * Three-way merge of a reader's update (`patch`, made from `base`) with the
 * server's current row. A field the server already has is dropped; a field the
 * server did not change since `base` is kept; a field both changed to different
 * values is a conflict for the reader (decision D1).
 */
export function merge(
	base: Row | undefined,
	patch: Row,
	server: Row | null | undefined,
): MergeResult {
	if (!server) return { deleted: true };
	const autoPatch: Row = {};
	const newBase: Row = {};
	const conflicts: FieldConflict[] = [];
	for (const [field, mine] of Object.entries(patch)) {
		const theirs = server[field];
		if (sameValue(mine, theirs)) continue;
		if (!base || !(field in base) || sameValue(base[field], theirs)) {
			autoPatch[field] = mine;
			newBase[field] = theirs ?? null;
			continue;
		}
		conflicts.push({ field, base: base[field], mine, theirs });
	}
	const updatedAt = server.updatedAt;
	return {
		deleted: false,
		autoPatch,
		conflicts,
		newBase,
		newBaseUpdatedAt: typeof updatedAt === "string" ? updatedAt : undefined,
	};
}
