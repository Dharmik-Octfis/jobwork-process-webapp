import type { AuthResult } from '../auth/auth.types.ts';

/** An invitation as safe to return to an org admin — never includes `tokenHash`. */
export interface PublicInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  invitedByName: string;
  expiresAt: string;
  createdAt: string;
}

/** Lifecycle state the public accept page resolves a token to. */
export type InvitationLookupStatus = 'valid' | 'expired' | 'accepted' | 'revoked' | 'invalid';

/**
 * What the public accept page needs before it can render — without leaking
 * anything an anonymous visitor shouldn't see. `accountExists` drives the
 * branch between "sign in to accept" and "create your account".
 */
export interface InvitationLookupResult {
  status: InvitationLookupStatus;
  organizationName: string | null;
  email: string | null;
  role: string | null;
  /** Whether a user account already exists for the invited email. */
  accountExists: boolean;
}

/**
 * Result of accepting an invite. `autoLogin` is set only when a brand-new user
 * created their account during accept — the controller then issues cookies for
 * them exactly as signup does. A logged-in acceptor gets `autoLogin: null`.
 */
export interface AcceptInvitationResult {
  organization: { id: string; name: string };
  role: string;
  autoLogin: AuthResult | null;
}
