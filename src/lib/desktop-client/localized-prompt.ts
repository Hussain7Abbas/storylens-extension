import { sendMessage } from "@/entrypoints/background/messaging";
import { runLocalizedPrompt } from "@/lib/ai-source/prompt-runner";
import type { AiFeature, AiSource } from "@/lib/ai-source/source";
import { aiState } from "@/lib/ai-source/storage";
import { unwrapAiReply } from "@/lib/cloud-ai/errors";
import type { AiLanguage } from "./ai-language";
import type { DesktopSettings } from "./types";

export async function executeLocalizedPrompt<T>(input: {
	prompt: string;
	language: AiLanguage;
	feature: Exclude<AiFeature, "character_image">;
	source?: AiSource;
	settings?: DesktopSettings;
	novelId?: string;
	signal: AbortSignal;
	webSearch?: boolean;
	parse: (output: string) => T;
	texts: (result: T) => string[];
}): Promise<T> {
	const state = await aiState(input.feature);
	const source = input.source ?? state.source,
		settings = input.settings ?? state.desktop;
	return runLocalizedPrompt({
		...input,
		cloud: source === "cloud",
		execute: async (prompt, actionId, attempt) => {
			const requestId = crypto.randomUUID();
			const cancel = () => {
				void sendMessage("cancelAiPrompt", requestId).catch(() => {});
			};
			input.signal.addEventListener("abort", cancel, { once: true });
			try {
				if (input.signal.aborted)
					throw new DOMException("Aborted", "AbortError");
				return unwrapAiReply(
					await sendMessage("executeAiPrompt", {
						source,
						requestId,
						actionId,
						attempt,
						feature: input.feature,
						prompt,
						responseLanguage: input.language,
						model: settings.model,
						effort: settings.effort,
						...(input.novelId ? { novelId: input.novelId } : {}),
						...(input.webSearch ? { webSearch: true } : {}),
					}),
				);
			} finally {
				input.signal.removeEventListener("abort", cancel);
			}
		},
	});
}
