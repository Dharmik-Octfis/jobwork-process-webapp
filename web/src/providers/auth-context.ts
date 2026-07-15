import { createContext, useContext } from 'react';
import type { User } from '../features/auth/auth.types';

export interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  /**
   * True while the initial session-restore (refresh-cookie exchange) is in
   * flight on app load. Guards route redirects from firing before we know
   * whether the visitor is already logged in.
   */
  isLoading: boolean;
  /** Store the user after login/signup. The access token is held in memory by the api layer. */
  setSession: (user: User) => void;
  /** Clear the session (logout / refresh failure). */
  clearSession: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Access the auth context. Throws if used outside <AuthProvider>. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return ctx;
}
