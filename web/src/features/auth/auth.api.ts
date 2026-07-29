import { apiClient, setAccessToken } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import type { AuthResponse } from './auth.types';
import type { LoginInput, SignupInput, UpdateProfileInput } from './auth.schemas';

/** POST /api/auth/login */
export async function login(input: LoginInput): Promise<AuthResponse> {
  const { data } = await apiClient.post<AuthResponse>(endpoints.auth.login, input);
  setAccessToken(data.accessToken);
  return data;
}

/**
 * POST /api/auth/signup — creates the user account only. Organization creation
 * and membership are a separate, later step.
 */
export async function signup(input: SignupInput): Promise<AuthResponse> {
  const { confirmPassword: _confirmPassword, ...payload } = input;
  const { data } = await apiClient.post<AuthResponse>(endpoints.auth.signup, payload);
  setAccessToken(data.accessToken);
  return data;
}

export async function updateProfile(input: UpdateProfileInput): Promise<{ user: AuthResponse['user'] }> {
  const { data } = await apiClient.put<{ user: AuthResponse['user'] }>(endpoints.auth.me, input);
  return data;
}

export async function uploadAvatar(file: File): Promise<{ user: AuthResponse['user'] }> {
  const formData = new FormData();
  formData.append('avatar', file);
  const { data } = await apiClient.post<{ user: AuthResponse['user'] }>(
    endpoints.auth.avatar,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
    },
  );
  return data;
}

export async function forgotPassword(input: { email: string }): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>(endpoints.auth.forgotPassword, input);
  return data;
}

export async function resetPassword(
  input: import('./auth.schemas').ResetPasswordInput,
): Promise<{ message: string }> {
  const { confirmPassword: _confirmPassword, ...payload } = input;
  const { data } = await apiClient.post<{ message: string }>(endpoints.auth.resetPassword, payload);
  return data;
}

export async function changePassword(
  input: import('./auth.schemas').ChangePasswordInput,
): Promise<{ message: string }> {
  const { confirmPassword: _confirmPassword, ...payload } = input;
  const { data } = await apiClient.post<{ message: string }>(endpoints.auth.changePassword, payload);
  return data;
}


/**
 * POST /auth/logout — the server ends the session using the Bearer access token
 * (or the refresh cookie as a fallback) and clears the refresh cookie. No body
 * is needed; both credentials travel automatically.
 */
export async function logout(): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>(endpoints.auth.logout);
  return data;
}

/**
 * Restore a session on app load by exchanging the httpOnly refresh cookie for a
 * fresh access token. Returns the user on success, or null when there's no
 * valid cookie (i.e. the visitor isn't logged in). The access token is stashed
 * in memory as a side effect.
 */
export async function restoreSession(): Promise<{ user: AuthResponse['user'] } | null> {
  const doRestore = async () => {
    try {
      const { data } = await apiClient.post<AuthResponse>(endpoints.auth.refresh);
      setAccessToken(data.accessToken);
      return { user: data.user };
    } catch {
      setAccessToken(null);
      return null;
    }
  };

  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('auth_refresh', doRestore);
  }
  return doRestore();
}
