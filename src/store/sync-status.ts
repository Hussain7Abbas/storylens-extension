import { atom, getDefaultStore, useAtomValue } from "jotai";

export const activeSyncCountAtom = atom(0);

export function incrementActiveSync(): void {
	const store = getDefaultStore();
	store.set(activeSyncCountAtom, store.get(activeSyncCountAtom) + 1);
}

export function decrementActiveSync(): void {
	const store = getDefaultStore();
	store.set(
		activeSyncCountAtom,
		Math.max(0, store.get(activeSyncCountAtom) - 1),
	);
}

export function useActiveSyncCount(): number {
	return useAtomValue(activeSyncCountAtom);
}
