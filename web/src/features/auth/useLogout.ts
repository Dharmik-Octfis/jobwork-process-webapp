import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../providers/auth-context';
import { logout } from './auth.api';
import { useAuthConfig } from './useAuthConfig';

/**
 * Logs the user out by invalidating the refresh token on the backend,
 * clearing local auth state, and redirecting to the login page.
 *
 * 🔴 When SSO is on, "log out" cannot end at this app. Clearing the local session
 * leaves the SSO cookie alive at the identity provider, so the next sign-in
 * completes silently and instantly — to the user the button did nothing, and on a
 * shared machine the previous person is one click from being back in. So the
 * browser is handed to `/api/auth/sso/logout`, which revokes the local session
 * FIRST and then redirects on to the provider to end the SSO session too.
 */
export function useLogout() {
  const { clearSession } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authConfig = useAuthConfig();
  const ssoEnabled = authConfig.data?.ssoEnabled ?? false;

  return useMutation({
    // Under SSO the server-side revoke happens inside /auth/sso/logout, so calling
    // the local endpoint first would just end the same session twice.
    mutationFn: async (): Promise<void> => {
      if (ssoEnabled) return;
      await logout();
    },
    onSettled: () => {
      // Runs whether the call succeeded or failed: local state is cleared either
      // way, because a user who pressed "log out" must not stay logged in here.
      clearSession();
      queryClient.clear();

      if (ssoEnabled) {
        /**
         * A full navigation, not `navigate()`. The point is to leave this origin
         * for the provider — a client-side route change would never reach it.
         */
        window.location.assign('/api/auth/sso/logout');
        return;
      }

      navigate('/login', { replace: true });
    },
  });
}
