import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { setAccessToken, toApiErrorMessage } from '../../api/client';
import { resetPassword } from './auth.api';

export function useResetPassword() {
  const navigate = useNavigate();

  return useMutation({
    mutationFn: resetPassword,
    onSuccess: () => {
      // The reset deleted every session server-side; drop the in-memory access
      // token too so the app can't keep making authenticated calls.
      setAccessToken(null);
      navigate('/login', { replace: true });
    },
    onError: (error) => {
      console.error(toApiErrorMessage(error));
    },
  });
}
