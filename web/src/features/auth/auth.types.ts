/**
 * Auth API types (the `*.types.ts` file for this feature — architecture §3.17).
 *
 * Per §3.17, API DTO types are the backend's job: Zod schemas produce the OpenAPI
 * spec, and `openapi-typescript` generates `web/src/api/schema.d.ts` from it. Each
 * feature's `*.types.ts` then just **re-exports** the types it needs, e.g.:
 *
 *   import type { components } from '../../api/schema';
 *   export type User = components['schemas']['User'];
 *   export type AuthResponse = components['schemas']['AuthResponse'];
 *
 * The OpenAPI spec isn't generated yet, so these shapes mirror
 * `backend/src/modules/auth/auth.types.ts` TEMPORARILY, as the single
 * client-side reference (never hand-mirror an API DTO in `src/types/`).
 * Replace them with re-exports once the spec exists — do not add a second copy.
 */

/**
 * The current authenticated user — identity only.
 *
 * No `role` and no `tenantId`: a user who has just signed up belongs to no
 * organization yet. Both are properties of a *membership* (architecture §3.9),
 * and roles are defined per tenant at runtime, never as a fixed union type.
 * Those types arrive with the organization feature.
 */
export interface User {
  id: string;
  name: string;
  email: string;
}

/** Response from `POST /auth/login` and `POST /auth/signup`. */
export interface AuthResponse {
  accessToken: string;
  user: User;
}
