import type { Mutation } from "@/lib/offline/types";
import { type Language, nameKey } from "@/utils/translation";

type Row = Record<string, unknown>;

/** Values a mutation knows about its entity: its patch over the last known server row. */
export function knownValues(mutation: Mutation, snapshotRow?: Row): Row {
	return {
		...(snapshotRow ?? {}),
		...(mutation.conflict?.server ?? {}),
		...mutation.patch,
	};
}

function nameOf(values: Row, language: Language): string {
	const own = values[nameKey(language)];
	const other = values[nameKey(language === "ar" ? "en" : "ar")];
	return String((own || other) ?? "");
}

/** A readable name for a mutation's entity in the UI language (status page, confirmations). */
export function describeEntity(
	mutation: Mutation,
	language: Language,
	snapshotRow?: Row,
): string {
	const values = knownValues(mutation, snapshotRow);
	switch (mutation.entity) {
		case "keyword":
		case "keywordAlias":
		case "keywordCategory":
		case "keywordNature":
			return nameOf(values, language);
		case "keywordVersion": {
			const start = values.startingChapter ?? values.currentChapter;
			const end = values.endingChapter;
			return start === undefined || start === null
				? ""
				: `ch.${start}${end === null || end === undefined ? "+" : `–${end}`}`;
		}
		case "replacement":
			return values.from || values.to
				? `${values.from ?? ""} → ${values.to ?? ""}`
				: "";
		case "file":
			return String(values.name ?? "");
	}
}

export type IssueKind =
	| NonNullable<Mutation["conflict"]>["kind"]
	| "other-account";

/** Why a mutation needs the reader: its conflict or rejection kind, or another account. */
export function issueKind(
	mutation: Mutation,
	userId: string | undefined,
): IssueKind | undefined {
	if (mutation.userId !== userId) return "other-account";
	if (mutation.status === "conflict" || mutation.status === "rejected")
		return mutation.conflict?.kind ?? "rule";
	return undefined;
}
