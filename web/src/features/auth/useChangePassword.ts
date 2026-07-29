import { useMutation } from '@tanstack/react-query';
import { changePassword } from './auth.api';
import type { ChangePasswordInput } from './auth.schemas';

export function useChangePassword() {
  return useMutation<{ message: string }, Error, ChangePasswordInput>({
    mutationFn: (input) => changePassword(input),
  });
}
