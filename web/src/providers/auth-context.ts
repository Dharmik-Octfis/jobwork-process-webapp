import { createContext, useContext } from 'react';
import type { User } from '../types/user';

export interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  /** Store the in-memory access token + user after login/signup. */
  setSession: (accessToken: string, user: User) => void;
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
