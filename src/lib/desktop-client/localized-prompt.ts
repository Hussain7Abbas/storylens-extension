import { sendMessage } from "@/entrypoints/background/messaging";
import {
	type AiLanguage,
	isInLanguage,
	languageCorrection,
} from "./ai-language";
import type { DesktopSettings } from "./types";

/**
 * Runs a desktop prompt from an extension page embedded in a tab and parses
 * its answer. When the parsed texts are not in `language`, it asks once more
 * with a correction so AI output always follows the extension language.
 */
export async function executeLocalizedPrompt<T>(input: {
	prompt: string;
	language: AiLanguage;
	settings: DesktopSettings;
	signal: AbortSignal;
	parse: (output: string) => T;
	texts: (result: T) => string[];
}): Promise<T> {
	let prompt = input.prompt;
	let result: T | undefined;
	for (let attempt = 0; attempt < 2; attempt++) {
		if (input.signal.aborted) throw new DOMException("Aborted", "AbortError");
		const requestId = crypto.randomUUID();
		const cancel = () => {
			void sendMessage("cancelDesktopPrompt", requestId).catch(() => {});
		};
		input.signal.addEventListener("abort", cancel, { once: true });
		try {
			const output = await sendMessage("executeDesktopPrompt", {
				requestId,
				prompt,
				model: input.settings.model,
				effort: input.settings.effort,
				responseLanguage: input.language,
			});
			result = input.parse(output);
		} finally {
			input.signal.removeEventListener("abort", cancel);
		}
		if (isInLanguage(input.texts(result), input.language)) return result;
		prompt = `${input.prompt}\n\n${languageCorrection(input.language)}`;
	}
	// Keep the second answer rather than failing when the model still ignores the language.
	return result as T;
}
