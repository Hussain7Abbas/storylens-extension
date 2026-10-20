import type { Language } from "@/utils/translation";

/** Cached/online rows are runtime data: Mantine rejects duplicate or non-string options. */
export function lookupOptions(
	rows: readonly unknown[] | undefined,
	language: Language,
): { value: string; label: string }[] {
	const options: { value: string; label: string }[] = [];
	const seen = new Set<string>();
	for (const row of Array.isArray(rows) ? rows : []) {
		if (!row || typeof row !== "object" || !("id" in row)) continue;
		if (typeof row.id !== "string" || !row.id.trim() || seen.has(row.id))
			continue;
		const ar =
			"nameAr" in row && typeof row.nameAr === "string" ? row.nameAr : "";
		const en =
			"nameEn" in row && typeof row.nameEn === "string" ? row.nameEn : "";
		const label =
			language === "ar" ? ar.trim() || en.trim() : en.trim() || ar.trim();
		if (!label) continue;
		seen.add(row.id);
		options.push({ value: row.id, label });
	}
	return options;
}
