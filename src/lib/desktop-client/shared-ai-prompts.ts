import { browser } from "#imports";
import { getAiInstructions } from "@/api/generated/endpoints/ai";
import { getStoredAuth } from "@/lib/auth/auth-storage";
import { isOnline } from "@/lib/offline/online-status";
import {
	type AiPrompts,
	parseAiPrompts,
	SHARED_AI_PROMPTS_KEY,
} from "./ai-prompts";

let pending: Promise<AiPrompts> | undefined;
/** Called in the background before a new prompt is built. Never reads legacy reader overrides. */
export async function loadSharedAiPrompts(): Promise<AiPrompts> {
	if (pending) return pending;
	pending = (async () => {
		const cached = parseAiPrompts(
			(await browser.storage.local.get(SHARED_AI_PROMPTS_KEY))[
				SHARED_AI_PROMPTS_KEY
			],
		);
		const { token } = await getStoredAuth();
		if (!token || !isOnline()) return cached;
		try {
			const { data } = await getAiInstructions({
				headers: { Authorization: `Bearer ${token}` },
				timeout: 5000,
			});
			const prompts = parseAiPrompts(data);
			await browser.storage.local.set({ [SHARED_AI_PROMPTS_KEY]: prompts });
			return prompts;
		} catch {
			// Offline and older APIs retain the last shared templates or bundled defaults.
			return cached;
		}
	})();
	try {
		return await pending;
	} finally {
		pending = undefined;
	}
}
