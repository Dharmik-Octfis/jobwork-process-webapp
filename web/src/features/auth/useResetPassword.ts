import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toApiErrorMessage } from '../../api/client';
import { resetPassword } from './auth.api';

export function useResetPassword() {
  const navigate = useNavigate();

  return useMutation({
    mutationFn: resetPassword,
    onSuccess: () => {
      // Clear any stored refresh token since they were deleted from DB
      localStorage.removeItem('refreshToken');
      navigate('/login', { replace: true });
    },
    onError: (error) => {
      console.error(toApiErrorMessage(error));
    },
  });
}
