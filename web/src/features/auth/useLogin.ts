import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../providers/auth-context';
import { login } from './auth.api';
import type { LoginInput } from './auth.schemas';

/**
 * Login mutation: calls the API, stores the session, and redirects to the
 * page the user originally wanted (or the app home).
 */
export function useLogin(redirectTo: string = '/') {
  const { setSession } = useAuth();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (input: LoginInput) => login(input),
    onSuccess: (data) => {
      setSession(data.accessToken, data.user);
      navigate(redirectTo, { replace: true });
    },
  });
}
