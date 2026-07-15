import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../providers/auth-context';
import { logout } from './auth.api';

/**
 * Logs the user out by invalidating the refresh token on the backend,
 * clearing local auth state, and redirecting to the login page.
 */
export function useLogout() {
  const { clearSession } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return useMutation({
    // The server ends the session from the Bearer token / refresh cookie and
    // clears the cookie; nothing to pass from the client.
    mutationFn: () => logout(),
    onSettled: () => {
      // This runs whether the API call succeeds or fails.
      // We always want to clear local state and force the user out.
      clearSession();
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });
}
