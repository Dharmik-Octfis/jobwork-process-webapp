import axios from 'axios';
import { env } from '../config/env';

/**
 * Shared axios instance for the Express API.
 *
 * - `withCredentials: true` so the httpOnly refresh-token cookie is sent (auth §3.8).
 * - The short-lived access token is kept **in memory** (never localStorage) and
 *   attached per request. `AuthProvider` owns the token and calls `setAccessToken`.
 */
export const apiClient = axios.create({
  baseURL: env.apiUrl,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

let accessToken: string | null = null;

/** Set (or clear) the in-memory access token attached to outgoing requests. */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

apiClient.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

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
