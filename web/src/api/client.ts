import axios from 'axios';
import { env } from '../config/env';

/**
 * Shared axios instance for the Express API.
 *
 * - `withCredentials: true` so the httpOnly access & refresh token cookies are sent.
 */
export const apiClient = axios.create({
  baseURL: env.apiUrl,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
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
