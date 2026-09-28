import { browser } from "#imports";
import { AI_PROMPTS_KEY, type AiPrompts, parseAiPrompts } from "./ai-prompts";
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

/** Reader AI prompts from Settings → AI, with defaults for empty ones. */
export async function aiPrompts(): Promise<AiPrompts> {
	return parseAiPrompts(
		(await browser.storage.local.get(AI_PROMPTS_KEY))[AI_PROMPTS_KEY],
	);
}

export async function saveAiPrompts(prompts: AiPrompts): Promise<void> {
	await browser.storage.local.set({ [AI_PROMPTS_KEY]: prompts });
}
