import { useMutation } from '@tanstack/react-query';
import { toApiErrorMessage } from '../../api/client';
import { forgotPassword } from './auth.api';

export function useForgotPassword() {
  return useMutation({
    mutationFn: forgotPassword,
    onError: (error) => {
      console.error(toApiErrorMessage(error));
    },
  });
}
