import { createContext, useContext } from 'react';
import type { User } from '../features/auth/auth.types';

export interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  /** Store the user after login/signup (tokens are handled automatically by cookies). */
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
