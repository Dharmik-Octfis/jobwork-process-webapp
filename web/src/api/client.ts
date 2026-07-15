import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import { env } from '../config/env';
import { endpoints } from './endpoints';

/**
 * Shared axios instance for the Express API.
 *
 * Token model (auth §3.8):
 * - Access token lives in memory here (never localStorage) and is attached as
 *   `Authorization: Bearer` by the request interceptor below.
 * - Refresh token is an httpOnly cookie the browser sends automatically;
 *   `withCredentials: true` is what lets it ride along to `/auth/*`.
 */
export const apiClient = axios.create({
  baseURL: env.apiUrl,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// --- In-memory access token ------------------------------------------------

let accessToken: string | null = null;

/** Set (or clear, with `null`) the in-memory access token. */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

apiClient.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// --- Silent refresh on 401 -------------------------------------------------

/**
 * A bad password on `/auth/login` is also a 401, and refreshing there is
 * pointless — only retry endpoints where a *lapsed access token* is the likely
 * cause. The refresh endpoint is excluded to avoid recursing on itself.
 */
const NO_REFRESH_PATHS = [
  endpoints.auth.login,
  endpoints.auth.signup,
  endpoints.auth.refresh,
  endpoints.auth.forgotPassword,
  endpoints.auth.resetPassword,
];

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

/**
 * Exchange the httpOnly refresh cookie for a new access token. Shared across
 * concurrent 401s (single-flight) so a burst of failed requests triggers just
 * one refresh. Uses the raw axios instance so this call skips the interceptors.
 */
let refreshInFlight: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= axios
    .post<{ accessToken: string }>(`${env.apiUrl}${endpoints.auth.refresh}`, null, {
      withCredentials: true,
    })
    .then((res) => {
      setAccessToken(res.data.accessToken);
      return res.data.accessToken;
    })
    .catch(() => {
      setAccessToken(null);
      return null;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config as RetriableConfig | undefined;
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    const skip = original?.url ? NO_REFRESH_PATHS.some((p) => original.url?.includes(p)) : false;

    if (status === 401 && original && !original._retry && !skip) {
      original._retry = true;
      const newToken = await refreshAccessToken();
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(original);
      }
    }

    return Promise.reject(error);
  },
);

/**
 * Turn an unknown thrown value (axios error, network error, …) into a
 * human-readable message that tells the user what happened.
 */
export function toApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string } | undefined;
    if (data?.message) return data.message;
    if (error.response?.status === 401) return 'Incorrect email or password.';
    if (error.response) return 'Something went wrong. Please try again.';
    return 'Cannot reach the server. Check your connection and try again.';
  }
  return 'Something went wrong. Please try again.';
}
