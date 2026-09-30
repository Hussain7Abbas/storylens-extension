/** A client-generated ID: creates keep it on the server, so nothing is remapped. */
export function newId(): string {
	return crypto.randomUUID();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
	return typeof value === "string" && UUID.test(value);
}
