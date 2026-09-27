export type AiLanguage = "en" | "ar";

export function toAiLanguage(locale: string): AiLanguage {
	return locale.toLowerCase().startsWith("ar") ? "ar" : "en";
}

/**
 * Prompt rule that pins generated text to the extension language, even when
 * the page is written in another one. Names may keep their original spelling.
 */
export function languageRule(language: AiLanguage): string {
	return language === "ar"
		? "Write every description in Arabic (العربية) only, even when the source text is English or another language. Keep names as they appear in the source, and keep the JSON keys in English."
		: "Write every description in English only, even when the source text is Arabic or another language. Keep names as they appear in the source, and keep the JSON keys in English.";
}

/** Rule appended to a retry after an answer came back in the wrong language. */
export function languageCorrection(language: AiLanguage): string {
	return language === "ar"
		? "Your previous answer was not written in Arabic. Answer again with every description written in Arabic (العربية)."
		: "Your previous answer was not written in English. Answer again with every description written in English.";
}

const ARABIC_LETTER = /[؀-ۿݐ-ݿࢠ-ࣿ]/gu;
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/gu;

/** Whether generated texts are mostly written in the requested script; empty text passes. */
export function isInLanguage(texts: string[], language: AiLanguage): boolean {
	const joined = texts.join(" ");
	const arabic = joined.match(ARABIC_LETTER)?.length ?? 0;
	const latin = joined.match(LATIN_LETTER)?.length ?? 0;
	if (arabic + latin === 0) return true;
	return language === "ar" ? arabic >= latin : latin >= arabic;
}
