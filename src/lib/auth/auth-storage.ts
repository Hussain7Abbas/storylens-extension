import { browser } from "#imports";
import type { AuthUser } from "./auth-store";

export const AUTH_STORAGE_KEY = "storylens-auth";

export interface StoredAuth {
	user: AuthUser | null;
	token: string | null;
}

export function parseStoredAuth(raw: unknown): StoredAuth {
	if (typeof raw !== "string") return { user: null, token: null };
	try {
		const parsed = JSON.parse(raw);
		return { user: parsed.user ?? null, token: parsed.token ?? null };
	} catch {
		return { user: null, token: null };
	}
}

export async function getStoredAuth(): Promise<StoredAuth> {
	const result = await browser.storage.local.get(AUTH_STORAGE_KEY);
	return parseStoredAuth(result[AUTH_STORAGE_KEY]);
}

export async function storeAuth(user: AuthUser, token: string): Promise<void> {
	await browser.storage.local.set({
		[AUTH_STORAGE_KEY]: JSON.stringify({ user, token }),
	});
}

export async function clearAuth(): Promise<void> {
	await browser.storage.local.remove(AUTH_STORAGE_KEY);
}
