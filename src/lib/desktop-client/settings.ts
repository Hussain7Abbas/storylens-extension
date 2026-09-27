import { browser } from "#imports";
import type { DesktopSettings } from "./types";
import { DESKTOP_SETTINGS_KEY } from "./types";

export function parseDesktopSettings(value: unknown): DesktopSettings {
	const stored =
		value && typeof value === "object"
			? (value as Partial<DesktopSettings>)
			: undefined;
	return {
		port: stored?.port ?? 43127,
		token: stored?.token ?? "",
		model: stored?.model ?? "",
		effort: stored?.effort ?? "",
	};
}

export async function desktopSettings(): Promise<DesktopSettings> {
	return parseDesktopSettings(
		(await browser.storage.local.get(DESKTOP_SETTINGS_KEY))[
			DESKTOP_SETTINGS_KEY
		],
	);
}
