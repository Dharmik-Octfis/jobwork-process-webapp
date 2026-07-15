import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../providers/auth-context';
import { signup } from './auth.api';
import type { SignupInput } from './auth.schemas';

/**
 * Signup mutation: creates the account, stores the session, and redirects
 * into the app.
 */
export function useSignup(redirectTo: string = '/') {
  const { setSession } = useAuth();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (input: SignupInput) => signup(input),
    onSuccess: (data) => {
      setSession(data.user);
      navigate(redirectTo, { replace: true });
    },
  });
}
