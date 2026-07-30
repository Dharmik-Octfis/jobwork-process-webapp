import { useMutation } from '@tanstack/react-query';
import { deleteAvatar } from './auth.api';
import { useAuth } from '../../providers/auth-context';

export function useDeleteAvatar() {
  const { setSession } = useAuth();

  return useMutation({
    mutationFn: deleteAvatar,
    onSuccess: (data) => {
      // The API returns the updated user, which we can use to update
      // the session via `setSession()` to keep the context in sync.
      setSession(data.user);
    },
  });
}
