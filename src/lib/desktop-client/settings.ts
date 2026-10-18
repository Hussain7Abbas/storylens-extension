import { browser } from "#imports";
import {
	type AiPrompts,
	parseAiPrompts,
	SHARED_AI_PROMPTS_KEY,
} from "./ai-prompts";
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

/** Fetch the centrally managed templates; the background keeps the last good values offline. */
export async function aiPrompts(): Promise<AiPrompts> {
	try {
		const { sendMessage } = await import("@/entrypoints/background/messaging");
		const prompts = await sendMessage("getAiInstructions");
		if (prompts) return parseAiPrompts(prompts);
	} catch {
		// A restarting/older background can still use the last shared snapshot.
	}
	return parseAiPrompts(
		(await browser.storage.local.get(SHARED_AI_PROMPTS_KEY))[
			SHARED_AI_PROMPTS_KEY
		],
	);
}
