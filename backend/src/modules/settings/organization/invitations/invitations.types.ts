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
 * What `createInvitation` returns: the invitation, and whether the email carrying
 * it actually left the building.
 *
 * 🔴 The second half exists because the answer used to be assumed. The service
 * catches a send failure, logs it, and still returns 201 so a provider outage does
 * not throw away a valid invitation — that part is right. What was missing is that
 * the caller could not tell the two cases apart, so the UI said "Invitation sent"
 * either way. On 2026-08-31 the mail provider ran out of credit and every
 * invitation, signup OTP and password reset failed silently; the only trace was a
 * `console.error` in a log nobody was tailing.
 *
 * 🔴 It sits BESIDE the invitation, not on it. Delivery is a fact about this one
 * request, not a property of the row — `listInvitations` reads the same rows later
 * and could only guess. One home, one reader.
 */
export interface CreateInvitationResult {
  invitation: PublicInvitation;
  emailDelivered: boolean;
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
  'valid' | 'expired' | 'accepted' | 'revoked' | 'declined' | 'invalid';

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
