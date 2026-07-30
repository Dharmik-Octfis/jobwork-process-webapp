import { useMutation } from '@tanstack/react-query';
import { updateProfile } from './auth.api';
import type { UpdateProfileInput } from './auth.schemas';
import type { User } from './auth.types';
import { toApiErrorMessage } from '../../api/client';
import { useAuth } from '../../providers/auth-context';

export function useUpdateProfile() {
  const { setSession } = useAuth();

  return useMutation<{ user: User }, Error, UpdateProfileInput>({
    mutationFn: (input) => updateProfile(input),
    onSuccess: (data) => {
      // Update the user in the context
      setSession(data.user);
    },
    onError: (error) => {
      console.error('Failed to update profile:', toApiErrorMessage(error));
    },
  });
}
