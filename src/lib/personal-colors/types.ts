export type LookupKind = "category" | "nature";
export type PersonalColors = Record<LookupKind, Record<string, string>>;
export type ColorChange = {
	kind: LookupKind;
	id: string;
	color: string | null;
};
export type ColorPreferences = {
	colors: PersonalColors;
	pending: Record<string, ColorChange & { revision: string }>;
	syncError?: boolean;
};
export const PERSONAL_COLORS_PREFIX = "storylens-personal-colors:";
export const personalColorsKey = (userId: string) =>
	`${PERSONAL_COLORS_PREFIX}${userId}`;
export const emptyColors = (): PersonalColors => ({ category: {}, nature: {} });
export const isHexColor = (value: unknown): value is string =>
	typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
export function parsePersonalColors(value: unknown): PersonalColors {
	const colors = emptyColors();
	if (!value || typeof value !== "object") return colors;
	for (const kind of ["category", "nature"] as const) {
		const entries = (value as Record<string, unknown>)[kind];
		if (!entries || typeof entries !== "object") continue;
		for (const [id, color] of Object.entries(entries))
			if (isHexColor(color)) colors[kind][id] = color;
	}
	return colors;
}
export function parseColorPreferences(value: unknown): ColorPreferences {
	const raw =
		value && typeof value === "object"
			? (value as Record<string, unknown>)
			: {};
	const pending: ColorPreferences["pending"] = {};
	if (raw.pending && typeof raw.pending === "object")
		for (const item of Object.values(raw.pending)) {
			if (!item || typeof item !== "object") continue;
			const change = item as Record<string, unknown>;
			if (
				(change.kind === "category" || change.kind === "nature") &&
				typeof change.id === "string" &&
				typeof change.revision === "string" &&
				(change.color === null || isHexColor(change.color))
			) {
				pending[`${change.kind}/${change.id}`] = {
					kind: change.kind,
					id: change.id,
					color: change.color,
					revision: change.revision,
				};
			}
		}
	return {
		colors: parsePersonalColors(raw.colors),
		pending,
		syncError: raw.syncError === true,
	};
}
export function lookupColor(
	colors: PersonalColors,
	kind: LookupKind,
	row: { id: string; color: string },
): string {
	return colors[kind][row.id] ?? row.color;
}
export function applyColorChange(
	colors: PersonalColors,
	change: ColorChange,
): void {
	if (change.color === null) delete colors[change.kind][change.id];
	else colors[change.kind][change.id] = change.color;
}
