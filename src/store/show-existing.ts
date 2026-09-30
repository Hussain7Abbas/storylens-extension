import { atom } from "jotai";

/**
 * "Show existing" from the Sync status page: the home screen selects this
 * novel and the coloring tab opens searched to this name. Each consumer clears
 * its own field once applied.
 */
export const showExistingAtom = atom<{ novelId?: string; search?: string }>({});
