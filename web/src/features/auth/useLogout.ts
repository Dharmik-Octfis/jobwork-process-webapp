import { useMutation } from '@tanstack/react-query';
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

  return useMutation({
    mutationFn: async () => {
      // Retrieve the token from localStorage
      const refreshToken = localStorage.getItem('refreshToken');
      // Always call the API, even if the token isn't found locally, 
      // just in case we need to clear httpOnly cookies on the backend.
      return logout({ refreshToken });
    },
    onSettled: () => {
      // This runs whether the API call succeeds or fails.
      // We always want to clear local state and force the user out.
      clearSession();
      navigate('/login', { replace: true });
    },
  });
}
