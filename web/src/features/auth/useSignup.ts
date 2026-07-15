import { useMutation } from '@tanstack/react-query';
import { useAuth } from '../../providers/auth-context';
import { signup } from './auth.api';
import type { SignupInput } from './auth.schemas';
import { useAuthRedirect } from './useAuthRedirect';

/**
 * Signup mutation: creates the account, stores the session, and redirects
 * into the app.
 */
export function useSignup(redirectTo: string = '/') {
  const { setSession } = useAuth();
  const redirectAfterAuth = useAuthRedirect();

  return useMutation({
    mutationFn: (input: SignupInput) => signup(input),
    onSuccess: async (data) => {
      setSession(data.user);

      await redirectAfterAuth(redirectTo);
    },
  });
}

