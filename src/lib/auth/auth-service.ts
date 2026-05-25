import { browser } from "#imports";
import { axiosInstance } from "@/api/axios-instance";
import type { AuthUser } from "./auth-store";
import { generateGuestUsername } from "./guest-names";

const STORAGE_KEY = "storylens-auth";

interface AuthResponse {
	user: AuthUser;
	token: string;
}

export async function getStoredAuth(): Promise<{
	user: AuthUser | null;
	token: string | null;
}> {
	const result = await browser.storage.local.get(STORAGE_KEY);
	const raw = result[STORAGE_KEY];
	if (!raw) return { user: null, token: null };
	try {
		const parsed = JSON.parse(raw);
		return { user: parsed.user ?? null, token: parsed.token ?? null };
	} catch {
		return { user: null, token: null };
	}
}

export async function storeAuth(user: AuthUser, token: string): Promise<void> {
	await browser.storage.local.set({
		[STORAGE_KEY]: JSON.stringify({ user, token }),
	});
}

export async function clearAuth(): Promise<void> {
	await browser.storage.local.remove(STORAGE_KEY);
}

export async function createGuestAccount(): Promise<AuthResponse> {
	const username = generateGuestUsername();

	const response = await axiosInstance.post<AuthResponse>("/auth/guest", {
		username,
	});

	const { user, token } = response.data;
	await storeAuth(user, token);
	return { user, token };
}

export async function loginWithEmail(
	email: string,
	password: string,
): Promise<AuthResponse> {
	const response = await axiosInstance.post<AuthResponse>("/auth/login", {
		email,
		password,
	});

	const { user, token } = response.data;
	await storeAuth(user, token);
	return { user, token };
}

export async function registerAccount(data: {
	email: string;
	password: string;
	username: string;
	name?: string;
}): Promise<AuthResponse> {
	const response = await axiosInstance.post<AuthResponse>(
		"/auth/register",
		data,
	);

	const { user, token } = response.data;
	await storeAuth(user, token);
	return { user, token };
}

export async function updateProfile(data: {
	username?: string;
	name?: string;
}): Promise<AuthUser> {
	const response = await axiosInstance.put<AuthUser>("/auth/me", data);
	const user = response.data;
	const stored = await getStoredAuth();
	await storeAuth(user, stored.token ?? "");
	return user;
}

export async function checkUsernameAvailability(
	username: string,
): Promise<boolean> {
	const response = await axiosInstance.get<{ available: boolean }>(
		`/auth/check-username/${encodeURIComponent(username)}`,
	);
	return response.data.available;
}

export function setupAuthInterceptor(): void {
	axiosInstance.interceptors.request.use(async (config) => {
		const { token } = await getStoredAuth();
		if (token) {
			config.headers.Authorization = `Bearer ${token}`;
		}
		return config;
	});
}
