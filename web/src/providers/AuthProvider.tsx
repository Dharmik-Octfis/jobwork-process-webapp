import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { setAccessToken } from '../api/client';
import type { User } from '../types/user';
import { AuthContext } from './auth-context';
import type { AuthContextValue } from './auth-context';

/**
 * Holds global auth state: the current user and — via `api/client` — the
 * short-lived access token in memory (never localStorage; auth §3.8).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const setSession = useCallback((accessToken: string, nextUser: User) => {
    setAccessToken(accessToken);
    setUser(nextUser);
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isAuthenticated: user !== null, setSession, clearSession }),
    [user, setSession, clearSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
