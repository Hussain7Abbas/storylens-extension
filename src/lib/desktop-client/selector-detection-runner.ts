import type { AiSource } from "../ai-source/source";
import type { AiLanguage } from "./ai-language";
import { executeLocalizedPrompt } from "./localized-prompt";
import {
	buildSelectorDetectionPrompt,
	type Detection,
	parseSelectorSuggestion,
	validateSelectorSuggestion,
} from "./selector-detection";
import type { DesktopSettings } from "./types";
export async function detectChapterSelectorsWithDesktop(input: {
	url: string;
	html: string;
	language: AiLanguage;
	settings: DesktopSettings;
	source?: AiSource;
	signal: AbortSignal;
}): Promise<Detection> {
	return executeLocalizedPrompt({
		feature: "selector_detection",
		source: input.source,
		prompt: buildSelectorDetectionPrompt(input),
		language: input.language,
		settings: input.settings,
		signal: input.signal,
		parse: (output) => {
			const result = validateSelectorSuggestion(
				input,
				parseSelectorSuggestion(output),
			);
			if (result.validation.errors.length)
				throw new Error(result.validation.errors.join("; "));
			return result;
		},
		texts: (result) => [result.result.notes ?? ""],
	});
}
