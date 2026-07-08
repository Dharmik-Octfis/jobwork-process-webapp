/**
 * Typed access to Vite build-time env vars (only `VITE_*` are exposed).
 * See docs/FRONTEND_SETUP.md §7.
 */
interface AppEnv {
  /** Base URL for the Express API. Dev: `/api` (Vite proxy); prod: deployed URL. */
  apiUrl: string;
}

export const env: AppEnv = {
  apiUrl: import.meta.env.VITE_API_URL ?? '/api',
};
