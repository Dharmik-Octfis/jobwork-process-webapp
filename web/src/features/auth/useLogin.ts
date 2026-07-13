import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../providers/auth-context';
import { toApiErrorMessage } from '../../api/client';
import { login } from './auth.api';

/**
 * Logs the user in, saves their refresh token in localStorage, and redirects them.
 */
export function useLogin(redirectTo = '/') {
  const { setSession } = useAuth();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: login,
    onSuccess: (data) => {
      if (data.refreshToken) {
        localStorage.setItem('refreshToken', data.refreshToken);
      }
      setSession(data.user);
      navigate(redirectTo, { replace: true });
    },
    onError: (error) => {
      // Components read this to show the banner.
      console.error(toApiErrorMessage(error));
    },
  });
}
