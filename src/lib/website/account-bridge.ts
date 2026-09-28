import type { StoredAuth } from "@/lib/auth/auth-storage";
import { type AuthUser, normalizeAuthUser } from "@/lib/auth/auth-store";

// Mirrors the website's `src/lib/account/bridge.ts`; keep both in sync.
export const ACCOUNT_BRIDGE_CHANNEL = "storylens-account";

export type PageRequest =
	| { type: "get"; id: string }
	| { type: "set"; id: string; session: { user: AuthUser; token: string } }
	| { type: "clear"; id: string };

export interface ExtensionMessage {
	channel: typeof ACCOUNT_BRIDGE_CHANNEL;
	from: "extension";
	type: "session";
	id?: string;
	session: StoredAuth | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function parsePageRequest(data: unknown): PageRequest | null {
	if (
		!isRecord(data) ||
		data.channel !== ACCOUNT_BRIDGE_CHANNEL ||
		data.from !== "page" ||
		typeof data.id !== "string"
	) {
		return null;
	}
	if (data.type === "get" || data.type === "clear") {
		return { type: data.type, id: data.id };
	}
	if (data.type === "set" && isRecord(data.session)) {
		const { token } = data.session;
		// Keeps only known user fields; accepts sessions from older website builds.
		const user = normalizeAuthUser(data.session.user);
		if (user && typeof token === "string" && token.length > 0) {
			return { type: "set", id: data.id, session: { user, token } };
		}
	}
	return null;
}
