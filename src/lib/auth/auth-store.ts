import { atom } from "jotai";

/** Capability that lets a reader-portal role change shared and others' data. */
export const MODERATE_PERMISSION = "user:moderate";

/**
 * What the popup offers a user. The API enforces the real permissions; this
 * only hides actions a role cannot use: guests read, readers edit their own
 * content, moderators (roles holding `user:moderate`) edit everything.
 */
export type AccessLevel = "guest" | "reader" | "moderator";

export interface AuthUser {
	id: string;
	email: string;
	username: string;
	name: string;
	isGuest: boolean;
	role: { id: string; slug: string; name: string } | null;
	/** Permission keys from the API, e.g. `POST /api/user/keywords/`. */
	permissions: string[];
}

export interface AuthState {
	user: AuthUser | null;
	token: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function toRole(value: unknown): AuthUser["role"] {
	if (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.slug === "string" &&
		typeof value.name === "string"
	) {
		return { id: value.id, slug: value.slug, name: value.name };
	}
	return null;
}

/** Accepts an API user or a stored one; returns null for anything else. */
export function normalizeAuthUser(value: unknown): AuthUser | null {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		typeof value.email !== "string" ||
		typeof value.username !== "string" ||
		typeof value.name !== "string"
	) {
		return null;
	}

	const base = {
		id: value.id,
		email: value.email,
		username: value.username,
		name: value.name,
	};

	if (Array.isArray(value.permissions)) {
		return {
			...base,
			isGuest: value.isGuest === true,
			role: toRole(value.role),
			permissions: value.permissions.filter(
				(key): key is string => typeof key === "string",
			),
		};
	}

	return null;
}

export function accessLevelOf(user: AuthUser | null): AccessLevel {
	if (!user || user.isGuest) return "guest";
	return user.permissions.includes(MODERATE_PERMISSION)
		? "moderator"
		: "reader";
}

export const authStateAtom = atom<AuthState>({ user: null, token: null });

export const onboardingCompletedAtom = atom<boolean>(false);

export const currentUserAtom = atom<AuthUser | null>(
	(get) => get(authStateAtom).user,
);

export const authTokenAtom = atom<string | null>(
	(get) => get(authStateAtom).token,
);

export const userAccessAtom = atom<AccessLevel>((get) =>
	accessLevelOf(get(authStateAtom).user),
);
