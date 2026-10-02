/**
 * Arabic diacritics (حركات) that never change which word is written: tanween,
 * the short vowels, shadda, sukun, the dagger alif, Quranic annotation marks
 * and tatweel. The hamza and madda marks (U+0653–U+0655) stay because they
 * form letters (أ إ آ ؤ ئ). Keep this set identical to the backend's
 * `src/utils/arabic.ts`. No React or extension APIs: content scripts import it.
 */
export const ARABIC_DIACRITICS_CLASS =
	"[\\u{0640}\\u{064B}-\\u{0652}\\u{0656}-\\u{065F}\\u{0670}\\u{06D6}-\\u{06DC}\\u{06DF}-\\u{06E4}\\u{06E7}\\u{06E8}\\u{06EA}-\\u{06ED}]";

const ARABIC_DIACRITICS = new RegExp(ARABIC_DIACRITICS_CLASS, "gu");
const ARABIC_DIACRITIC = new RegExp(`^${ARABIC_DIACRITICS_CLASS}$`, "u");

export function isArabicDiacritic(character: string): boolean {
	return ARABIC_DIACRITIC.test(character);
}

/** Letters only: matching and stored keyword names ignore diacritics. */
export function stripArabicDiacritics(value: string): string {
	return value.normalize("NFC").replace(ARABIC_DIACRITICS, "").normalize("NFC");
}

/** A keyword or alias name as the API stores it: trimmed, without diacritics, null when empty. */
export function cleanKeywordName(value: string): string | null {
	return stripArabicDiacritics(value.trim()).trim() || null;
}

/** Compares names by letters only: no diacritics, case or outer spaces. */
export function nameKey(value: string): string {
	return stripArabicDiacritics(value).trim().toLowerCase();
}

/** Regex source matching `term` in page text whatever diacritics follow its Arabic letters. */
export function lettersPattern(term: string): string {
	return [...stripArabicDiacritics(term)]
		.map((letter) => {
			const escaped = letter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			return /\p{Script=Arabic}/u.test(letter)
				? `${escaped}${ARABIC_DIACRITICS_CLASS}*`
				: escaped;
		})
		.join("");
}
