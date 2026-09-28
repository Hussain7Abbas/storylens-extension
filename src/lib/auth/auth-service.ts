import { axiosInstance } from "@/api/axios-instance";
import { getStoredAuth, storeAuth } from "./auth-storage";
import { type AuthUser, normalizeAuthUser } from "./auth-store";
import { generateGuestUsername } from "./guest-names";

interface AuthResponse {
	user: AuthUser;
	token: string;
}

interface GuestResponse {
	user: unknown;
	token: string;
}

export async function createGuestAccount(): Promise<AuthResponse> {
	const username = generateGuestUsername();

	const response = await axiosInstance.post<GuestResponse>(
		"/api/user/auth/guest",
		{
			username,
		},
	);

	const { token } = response.data;
	const user = normalizeAuthUser(response.data.user);
	if (!user) throw new Error("Unexpected guest account response");
	await storeAuth(user, token);
	return { user, token };
}

/**
 * Reloads the signed-in user so role and permission changes made in the
 * dashboard reach the popup; the storage listener picks up the stored copy.
 * Keeps the stored user when offline or on error.
 */
export async function refreshCurrentUser(
	token: string,
): Promise<AuthUser | null> {
	try {
		const response = await axiosInstance.get<unknown>("/api/user/auth/me", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const user = normalizeAuthUser(response.data);
		if (user) await storeAuth(user, token);
		return user;
	} catch {
		return null;
	}
}

export async function checkUsernameAvailability(
	username: string,
): Promise<boolean> {
	const response = await axiosInstance.get<{ available: boolean }>(
		`/api/user/auth/check-username/${encodeURIComponent(username)}`,
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
