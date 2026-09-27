import type { DesktopSettings } from "./types";

/** AI actions need a paired desktop client with a chosen model and effort. */
export function isAiConfigured(
	settings: Pick<DesktopSettings, "token" | "model" | "effort">,
): boolean {
	return !!settings.token && !!settings.model && !!settings.effort;
}
