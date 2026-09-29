import { browser } from "#imports";
import {
	type Language,
	LOCALE_STORAGE_KEY,
	toLanguage,
} from "@/utils/translation";

/**
 * The current UI language. Extension pages read the popup's own locale atom
 * (localStorage `locale`), which updates before its mirror in extension storage;
 * the background and content scripts read the mirror.
 */
export async function getStoredLanguage(): Promise<Language> {
	if (/^(chrome|moz)-extension:$/.test(globalThis.location?.protocol ?? "")) {
		try {
			const locale = globalThis.localStorage?.getItem("locale");
			if (locale) return toLanguage(JSON.parse(locale));
		} catch {
			// Fall back to extension storage.
		}
	}
	const stored = await browser.storage.local.get(LOCALE_STORAGE_KEY);
	return toLanguage(stored[LOCALE_STORAGE_KEY]);
}
