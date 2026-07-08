import { apiClient } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import type { User } from '../../types/user';
import type { LoginInput, SignupInput } from './auth.schemas';

/** Backend returns the short-lived access token + the authenticated user. */
export interface AuthResponse {
  accessToken: string;
  user: User;
}

/** POST /api/auth/login */
export async function login(input: LoginInput): Promise<AuthResponse> {
  const { data } = await apiClient.post<AuthResponse>(endpoints.auth.login, input);
  return data;
}

/** POST /api/auth/signup — creates the tenant + OWNER user. */
export async function signup(input: SignupInput): Promise<AuthResponse> {
  // `confirmPassword` is a client-only field; don't send it.
  const { confirmPassword: _confirmPassword, ...payload } = input;
  const { data } = await apiClient.post<AuthResponse>(endpoints.auth.signup, payload);
  return data;
}
