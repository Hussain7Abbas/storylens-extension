import type { AiLanguage } from "./ai-language";
import { executeLocalizedPrompt } from "./localized-prompt";
import {
	buildSelectorDetectionPrompt,
	type Detection,
	parseSelectorSuggestion,
	validateSelectorSuggestion,
} from "./selector-detection";
import type { DesktopSettings } from "./types";

/** Paired AI never sends this page to the backend OpenRouter route. */
export async function detectChapterSelectorsWithDesktop(input: {
	url: string;
	html: string;
	language: AiLanguage;
	settings: DesktopSettings;
	signal: AbortSignal;
}): Promise<Detection> {
	let errors: string[] | undefined;
	let detection: Detection | undefined;
	for (let attempt = 0; attempt < 2; attempt++) {
		const suggestion = await executeLocalizedPrompt({
			prompt: buildSelectorDetectionPrompt({ ...input, errors }),
			language: input.language,
			settings: input.settings,
			signal: input.signal,
			parse: parseSelectorSuggestion,
			texts: (result) => [result.notes ?? ""],
		});
		if (input.signal.aborted) throw new DOMException("Aborted", "AbortError");
		detection = validateSelectorSuggestion(input, suggestion);
		if (detection.validation.errors.length === 0) return detection;
		errors = detection.validation.errors;
	}
	return detection as Detection;
}
