import {
	type AiLanguage,
	isInLanguage,
	languageCorrection,
} from "../desktop-client/ai-language";
/** One billable action, at most two attempts. A failed correction keeps an already useful answer. */
export async function runLocalizedPrompt<T>(input: {
	prompt: string;
	language: AiLanguage;
	signal: AbortSignal;
	cloud: boolean;
	execute: (
		prompt: string,
		actionId: string,
		attempt: 1 | 2,
	) => Promise<string>;
	parse: (output: string) => T;
	texts: (result: T) => string[];
}): Promise<T> {
	const actionId = crypto.randomUUID();
	let prompt = input.prompt,
		parsed: T | undefined,
		hasParsed = false;
	for (const attempt of [1, 2] as const) {
		if (input.signal.aborted) throw new DOMException("Aborted", "AbortError");
		let output: string;
		try {
			output = await input.execute(prompt, actionId, attempt);
		} catch (error) {
			if (attempt === 2 && input.cloud && hasParsed && !input.signal.aborted)
				return parsed as T;
			throw error;
		}
		if (input.signal.aborted) throw new DOMException("Aborted", "AbortError");
		try {
			const next = input.parse(output);
			if (isInLanguage(input.texts(next), input.language) || attempt === 2)
				return next;
			parsed = next;
			hasParsed = true;
			prompt = `${input.prompt}\n\n${languageCorrection(input.language)}`;
		} catch (error) {
			if (attempt === 2) {
				if (input.cloud && hasParsed) return parsed as T;
				throw error;
			}
			prompt = `${input.prompt}\n\nYour previous answer was not valid JSON or failed validation. Return only a valid answer matching the requested schema. ${error instanceof Error ? error.message : ""}`;
		}
	}
	throw new Error("AI returned no usable answer.");
}
