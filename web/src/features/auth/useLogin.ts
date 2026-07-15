import { useMutation } from '@tanstack/react-query';
import { useAuth } from '../../providers/auth-context';
import { toApiErrorMessage } from '../../api/client';
import { login } from './auth.api';
import { useAuthRedirect } from './useAuthRedirect';

/**
 * Logs the user in and redirects them. The access token is stored in memory by
 * the api layer; the refresh token is set as an httpOnly cookie by the server.
 */
export function useLogin(redirectTo = '/') {
  const { setSession } = useAuth();
  const redirectAfterAuth = useAuthRedirect();

  return useMutation({
    mutationFn: login,
    onSuccess: async (data) => {
      setSession(data.user);

      // Wait for auth context to settle and then decide where to redirect
      await redirectAfterAuth(redirectTo);
    },
    onError: (error) => {
      // Components read this to show the banner.
      console.error(toApiErrorMessage(error));
    },
  });
}

