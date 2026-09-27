import { axiosInstance } from "@/api/axios-instance";
import { getStoredAuth, storeAuth } from "./auth-storage";
import type { AuthUser } from "./auth-store";
import { generateGuestUsername } from "./guest-names";

interface AuthResponse {
	user: AuthUser;
	token: string;
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
