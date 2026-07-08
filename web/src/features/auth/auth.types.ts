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
 * The auth backend module and its OpenAPI spec don't exist yet, so the shapes are
 * defined here TEMPORARILY as the single client-side reference (never hand-mirror
 * an API DTO in `src/types/`). Replace them with re-exports from the generated
 * schema once the backend is in place — do not add a second copy elsewhere.
 */

/** Roles per tenant (architecture §3.9). */
export type Role = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';

/** Current authenticated user. */
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenantId: string;
}

/** Response from `POST /auth/login` and `POST /auth/signup`. */
export interface AuthResponse {
  accessToken: string;
  user: User;
}
