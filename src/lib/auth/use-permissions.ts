import { useAtomValue } from 'jotai';
import { userRoleAtom } from './auth-store';

export function useCanMutate(): boolean {
  const role = useAtomValue(userRoleAtom);
  return role === 'user' || role === 'admin';
}

export function useIsAdmin(): boolean {
  const role = useAtomValue(userRoleAtom);
  return role === 'admin';
}
