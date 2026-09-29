import { useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { type Language, toLanguage } from "@/utils/translation";

export const localeAtom = atomWithStorage<string>("locale", "en");

/** The UI language, which decides the novel and keyword fields readers see and write. */
export function useLanguage(): Language {
	return toLanguage(useAtomValue(localeAtom));
}
