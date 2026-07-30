import { useMutation } from '@tanstack/react-query';
import { uploadAvatar } from './auth.api';
import type { User } from './auth.types';
import { toApiErrorMessage } from '../../api/client';
import { useAuth } from '../../providers/auth-context';

export function useUploadAvatar() {
  const { setSession } = useAuth();

  return useMutation<{ user: User }, Error, File>({
    mutationFn: (file) => uploadAvatar(file),
    onSuccess: (data) => {
      setSession(data.user);
    },
    onError: (error) => {
      console.error('Failed to upload avatar:', toApiErrorMessage(error));
    },
  });
}
