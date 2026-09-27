import type { StoredAuth } from "@/lib/auth/auth-storage";
import type { AuthUser } from "@/lib/auth/auth-store";

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

const ROLES: ReadonlySet<string> = new Set(["guest", "user", "admin"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isAuthUser(value: unknown): value is AuthUser {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.email === "string" &&
		typeof value.username === "string" &&
		typeof value.name === "string" &&
		typeof value.role === "string" &&
		ROLES.has(value.role)
	);
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
		const { user, token } = data.session;
		if (isAuthUser(user) && typeof token === "string" && token.length > 0) {
			return {
				type: "set",
				id: data.id,
				session: {
					user: {
						id: user.id,
						email: user.email,
						username: user.username,
						name: user.name,
						role: user.role,
					},
					token,
				},
			};
		}
	}
	return null;
}
