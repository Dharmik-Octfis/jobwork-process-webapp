/**
 * Response DTOs for the auth module — the one hand-written type file per
 * feature (architecture §3.17), needed here because the wire shape differs
 * from the Prisma row: `passwordHash` and `isActive` never leave the server.
 */

/** The user as the client sees it. */
export interface PublicUser {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  avatar_url?: string | null;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

/**
 * Returned by `POST /auth/signup`, `POST /auth/login`, and
 * `POST /auth/refresh-token`. The refresh token is NOT here — it's set as an
 * httpOnly cookie. Only the access token crosses in the body, for the client
 * to hold in memory and send as a Bearer credential.
 *
 * No `role` or `tenantId`: a freshly signed-up user belongs to no
 * organization. Those arrive on a separate membership DTO once organizations
 * exist (§3.9).
 */
export interface AuthResponse {
  accessToken: string;
  user: PublicUser;
}
