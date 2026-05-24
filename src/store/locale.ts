import { atomWithStorage } from 'jotai/utils';

export const localeAtom = atomWithStorage<string>('locale', 'en');
