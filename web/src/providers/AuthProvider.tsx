import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../features/auth/auth.types';
import { restoreSession } from '../features/auth/auth.api';
import { setAccessToken } from '../api/client';
import { AuthContext } from './auth-context';
import type { AuthContextValue } from './auth-context';

/**
 * Holds global auth state: the current user, plus — via `api/client` — the
 * short-lived access token in memory (never localStorage; auth §3.8).
 *
 * On mount it attempts a silent session restore: the httpOnly refresh cookie is
 * exchanged for a fresh access token so a page reload doesn't log the user out.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    restoreSession()
      .then((result) => {
        if (active && result) setUser(result.user);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const setSession = useCallback((nextUser: User) => {
    setUser(nextUser);
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isAuthenticated: user !== null, isLoading, setSession, clearSession }),
    [user, isLoading, setSession, clearSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
