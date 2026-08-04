import type { AuthResult } from '../../../auth/auth.types.ts';

/** An invitation as safe to return to an org admin — never includes `tokenHash`. */
export interface PublicInvitation {
  id: string;
  email: string;
  /**
   * The name the inviter entered, which becomes the invitee's name in THIS
   * organization when they accept. Null only on invitations created before names
   * were required — see the `invitations.first_name` schema comment.
   */
  firstName: string | null;
  lastName: string | null;
  /** `firstName lastName`, falling back to the email for a legacy nameless invite. */
  fullName: string;
  /** The job title the invitee will carry. Optional — it grants nothing. */
  roleId: string | null;
  roleName: string | null;
  /** The permission template this invite grants — the invitee's actual access. */
  permissionTemplateId: string;
  status: string;
  invitedByName: string;
  expiresAt: string;
  createdAt: string;
}

/**
 * An invitation as the RECIPIENT sees it in their in-app inbox — addressed by id,
 * never by token (the raw token is unrecoverable; only its hash is stored). No
 * token field here on purpose: the inbox authorizes by session + email match.
 */
export interface MyInvitation {
  id: string;
  organizationId: string;
  organizationName: string;
  /** The job title offered, if any. */
  roleName: string | null;
  invitedByName: string;
  expiresAt: string;
  createdAt: string;
}

/** Lifecycle state the public accept page resolves a token to. */
export type InvitationLookupStatus =
  | 'valid'
  | 'expired'
  | 'accepted'
  | 'revoked'
  | 'declined'
  | 'invalid';

/**
 * What the public accept page needs before it can render — without leaking
 * anything an anonymous visitor shouldn't see. `accountExists` drives the
 * branch between "sign in to accept" and "create your account".
 */
export interface InvitationLookupResult {
  status: InvitationLookupStatus;
  organizationName: string | null;
  email: string | null;
  /** Job title offered, for display on the accept page. Null when none was set. */
  roleName: string | null;
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
  /** The job title they joined with, if the invite carried one. */
  roleName: string | null;
  autoLogin: AuthResult | null;
}
