/** Preserve downloaded descriptions and queued edits written by older extensions. */
export function migrateImageDescription(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(migrateImageDescription);
	if (
		!value ||
		typeof value !== "object" ||
		Object.getPrototypeOf(value) !== Object.prototype
	)
		return value;
	const record = value as Record<string, unknown>;
	const result = Object.fromEntries(
		Object.entries(record).map(([key, entry]) => [
			key,
			migrateImageDescription(entry),
		]),
	);
	if (result.imageDescription === undefined && result.imagePrompt !== undefined)
		result.imageDescription = result.imagePrompt;
	delete result.imagePrompt;
	return result;
}
