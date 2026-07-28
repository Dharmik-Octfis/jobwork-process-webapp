import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uploadAvatar } from './auth.api';
import type { User } from './auth.types';
import { toApiErrorMessage } from '../../api/client';

export function useUploadAvatar() {
  const queryClient = useQueryClient();

  return useMutation<{ user: User }, Error, File>({
    mutationFn: (file) => uploadAvatar(file),
    onSuccess: (data) => {
      queryClient.setQueryData<User | null>(['user'], data.user);
    },
    onError: (error) => {
      console.error('Failed to upload avatar:', toApiErrorMessage(error));
    },
  });
}
