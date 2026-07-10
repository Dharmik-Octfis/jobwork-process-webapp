/**
 * Response DTOs for the auth module — the one hand-written type file per
 * feature (architecture §3.17), needed here because the wire shape differs
 * from the Prisma row: `passwordHash` and `isActive` never leave the server.
 */

/** The user as the client sees it. */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
}

/**
 * Returned by `POST /auth/signup` and `POST /auth/login`.
 *
 * No `role` or `tenantId`: a freshly signed-up user belongs to no
 * organization. Those arrive on a separate membership DTO once organizations
 * exist (§3.9).
 */
export interface AuthResponse {
  accessToken: string;
  user: PublicUser;
}
