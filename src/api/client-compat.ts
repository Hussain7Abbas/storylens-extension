import type { AxiosError, AxiosInstance, AxiosResponse } from "axios";
import { browser } from "#imports";

/** Tells the API which release is calling, so it can refuse unsupported ones. */
export const CLIENT_VERSION_HEADER = "X-Client-Version";
/** The API refuses releases older than its minimum with this status. */
export const UPGRADE_REQUIRED_STATUS = 426;

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
let lastUpdateCheck = 0;

/** `extension/<manifest version>`, or null where the manifest is unavailable. */
export function extensionClientVersion(): string | null {
	try {
		return `extension/${browser.runtime.getManifest().version}`;
	} catch {
		return null;
	}
}

/**
 * Asks the store for a newer build when the API refuses this one, and reloads
 * into it when one is ready. At most hourly; content scripts and browsers
 * without `requestUpdateCheck` (Firefox) wait for the automatic update.
 */
export async function requestExtensionUpdate(): Promise<void> {
	const now = Date.now();
	if (now - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS) return;
	lastUpdateCheck = now;

	try {
		if (typeof browser.runtime.requestUpdateCheck !== "function") return;
		const { status } = await browser.runtime.requestUpdateCheck();
		if (status === "update_available") browser.runtime.reload();
	} catch {
		// Throttled or unsupported; the browser still updates on its own schedule.
	}
}

function warnIfDeprecated(response: AxiosResponse): void {
	if (!import.meta.env.DEV || !response.headers.deprecation) return;
	console.warn(
		`[api] ${response.config.method?.toUpperCase()} ${response.config.url} is deprecated; sunset ${response.headers.sunset ?? "unknown"}. Regenerate the client and move off it.`,
	);
}

/**
 * Sends `X-Client-Version` on every request, reacts to 426 Upgrade Required,
 * and in development warns about deprecated endpoints (`Deprecation` header).
 */
export function installClientCompat(instance: AxiosInstance): void {
	instance.interceptors.request.use((config) => {
		const version = extensionClientVersion();
		if (version) config.headers.set(CLIENT_VERSION_HEADER, version);
		return config;
	});

	instance.interceptors.response.use(
		(response) => {
			warnIfDeprecated(response);
			return response;
		},
		(error: AxiosError) => {
			if (error.response?.status === UPGRADE_REQUIRED_STATUS) {
				void requestExtensionUpdate();
			}
			return Promise.reject(error);
		},
	);
}
