/** Empty/invalid values inherit; only six-digit hex colors can reach page styles. */
export function parseMainThemeColor(value: unknown): string | null {
	return typeof value === "string" &&
		value.length === 7 &&
		/^#[0-9a-f]{6}$/i.test(value)
		? value
		: null;
}
