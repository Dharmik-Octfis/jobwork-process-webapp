import { apiClient } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import type { AuthResponse } from './auth.types';
import type { LoginInput, SignupInput } from './auth.schemas';

/** POST /api/auth/login */
export async function login(input: LoginInput): Promise<AuthResponse> {
  const { data } = await apiClient.post<AuthResponse>(endpoints.auth.login, input);
  return data;
}

/**
 * POST /api/auth/signup — creates the user account only. Organization creation
 * and membership are a separate, later step.
 */
export async function signup(input: SignupInput): Promise<AuthResponse> {
  // `confirmPassword` is a client-only field; don't send it.
  const { confirmPassword: _confirmPassword, ...payload } = input;
  const { data } = await apiClient.post<AuthResponse>(endpoints.auth.signup, payload);
  return data;
}

export async function forgotPassword(input: { email: string }): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>(endpoints.auth.forgotPassword, input);
  return data;
}

export async function resetPassword(input: import('./auth.schemas').ResetPasswordInput): Promise<{ message: string }> {
  const { confirmPassword: _confirmPassword, ...payload } = input;
  const { data } = await apiClient.post<{ message: string }>(endpoints.auth.resetPassword, payload);
  return data;
}
