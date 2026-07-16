import { apiClient, setAccessToken } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import type { User } from '../auth/auth.types';

/** Lifecycle state the accept page resolves a token to (mirrors the backend). */
export type InvitationLookupStatus = 'valid' | 'expired' | 'accepted' | 'revoked' | 'invalid';

export interface InvitationLookup {
  status: InvitationLookupStatus;
  organizationName: string | null;
  email: string | null;
  role: string | null;
  /** Whether an account already exists for the invited email. */
  accountExists: boolean;
}

/** An invitation as an org admin sees it in the members list. */
export interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  invitedByName: string;
  expiresAt: string;
  createdAt: string;
}

export interface AcceptInvitationBody {
  firstName?: string;
  lastName?: string;
  password?: string;
}

export interface AcceptInvitationResult {
  organization: { id: string; name: string };
  role: string;
  /** Present only when a brand-new account was created during accept. */
  user?: User;
  accessToken?: string;
}

export const invitationsApi = {
  /** GET /invitations/:token — public lookup for the accept page. */
  lookup: async (token: string): Promise<InvitationLookup> => {
    const { data } = await apiClient.get<{ invitation: InvitationLookup }>(
      endpoints.invitations.byToken(token),
    );
    return data.invitation;
  },

  /**
   * POST /invitations/:token/accept. When the server creates a new account it
   * returns an access token + user; we store the session so the caller lands
   * signed in, exactly like signup.
   */
  accept: async (
    token: string,
    body: AcceptInvitationBody = {},
  ): Promise<AcceptInvitationResult> => {
    const { data } = await apiClient.post<AcceptInvitationResult>(
      endpoints.invitations.accept(token),
      body,
    );
    if (data.accessToken) setAccessToken(data.accessToken);
    return data;
  },

  /** GET /organizations/:orgId/invitations — pending invites (owner/admin). */
  listForOrg: async (orgId: string): Promise<Invitation[]> => {
    const { data } = await apiClient.get<{ invitations: Invitation[] }>(
      endpoints.invitations.forOrg(orgId),
    );
    return data.invitations;
  },

  /** POST /organizations/:orgId/invitations — send an invite (owner/admin). */
  create: async (
    orgId: string,
    body: { email: string; role: 'admin' | 'member' },
  ): Promise<Invitation> => {
    const { data } = await apiClient.post<{ invitation: Invitation }>(
      endpoints.invitations.forOrg(orgId),
      body,
    );
    return data.invitation;
  },

  /** DELETE /organizations/:orgId/invitations/:id — revoke a pending invite. */
  revoke: async (orgId: string, invitationId: string): Promise<void> => {
    await apiClient.delete(endpoints.invitations.revoke(orgId, invitationId));
  },
};
