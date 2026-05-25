import { atom } from "jotai";

export interface AuthUser {
	id: string;
	email: string;
	username: string;
	name: string;
	role: "guest" | "user" | "admin";
}

export interface AuthState {
	user: AuthUser | null;
	token: string | null;
}

export const authStateAtom = atom<AuthState>({ user: null, token: null });

export const onboardingCompletedAtom = atom<boolean>(false);

export const currentUserAtom = atom<AuthUser | null>(
	(get) => get(authStateAtom).user,
);

export const authTokenAtom = atom<string | null>(
	(get) => get(authStateAtom).token,
);

export const userRoleAtom = atom<"guest" | "user" | "admin">(
	(get) => get(authStateAtom).user?.role ?? "guest",
);
