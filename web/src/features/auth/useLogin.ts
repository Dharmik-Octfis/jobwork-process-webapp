import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../providers/auth-context';
import { toApiErrorMessage } from '../../api/client';
import { login } from './auth.api';

/**
 * Logs the user in and redirects them. The access token is stored in memory by
 * the api layer; the refresh token is set as an httpOnly cookie by the server.
 */
export function useLogin(redirectTo = '/') {
  const { setSession } = useAuth();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: login,
    onSuccess: (data) => {
      setSession(data.user);
      navigate(redirectTo, { replace: true });
    },
    onError: (error) => {
      // Components read this to show the banner.
      console.error(toApiErrorMessage(error));
    },
  });
}
