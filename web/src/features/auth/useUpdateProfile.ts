import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateProfile } from './auth.api';
import type { UpdateProfileInput } from './auth.schemas';
import type { User } from './auth.types';
import { toApiErrorMessage } from '../../api/client';

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation<{ user: User }, Error, UpdateProfileInput>({
    mutationFn: (input) => updateProfile(input),
    onSuccess: (data) => {
      // Update the user query in the cache
      queryClient.setQueryData<User | null>(['user'], data.user);
    },
    onError: (error) => {
      console.error('Failed to update profile:', toApiErrorMessage(error));
    },
  });
}
