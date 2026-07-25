import { apiClient, setAccessToken } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import type { User } from '../auth/auth.types';

/** Lifecycle state the accept page resolves a token to (mirrors the backend). */
export type InvitationLookupStatus =
  'valid' | 'expired' | 'accepted' | 'revoked' | 'declined' | 'invalid';

export interface InvitationLookup {
  status: InvitationLookupStatus;
  organizationName: string | null;
  email: string | null;
  /** Job title offered, if the inviter set one. Grants nothing by itself. */
  roleName: string | null;
  /** Name of the permission template this invite grants — the actual access. */
  permissionTemplateName: string | null;
  /** Whether an account already exists for the invited email. */
  accountExists: boolean;
}

/** An invitation as an org admin sees it in the members list. */
export interface Invitation {
  id: string;
  email: string;
  /** The job title the invitee will carry. Optional — it grants nothing. */
  roleId: string | null;
  roleName: string | null;
  /** The permission template the invite grants — always present. */
  permissionTemplateId: string;
  permissionTemplateName: string;
  status: string;
  invitedByName: string;
  expiresAt: string;
  createdAt: string;
}

/** An invitation as the RECIPIENT sees it in their inbox. No token — the inbox
 * acts by id, authorized by being signed in as the invited email. */
export interface MyInvitation {
  id: string;
  organizationId: string;
  organizationName: string;
  /** The job title offered, if any. */
  roleName: string | null;
  /** The access bundle offered — always present. */
  permissionTemplateName: string;
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
  roleName: string | null;
  permissionTemplateName: string;
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

  /** POST /invitations/:token/decline — say no, so the admin sees it rather than
   * watching the invite expire silently. No auth: the token is the credential. */
  decline: async (token: string): Promise<void> => {
    await apiClient.post(endpoints.invitations.decline(token));
  },

  // ── The recipient's inbox (authenticated, addressed by id) ──────────────────

  /** GET /me/invitations — live invitations addressed to the signed-in user. */
  listMine: async (): Promise<MyInvitation[]> => {
    const { data } = await apiClient.get<{ invitations: MyInvitation[] }>(
      endpoints.invitations.mine,
    );
    return data.invitations;
  },

  /** POST /me/invitations/:id/accept — no token needed; the session proves it. */
  acceptMine: async (
    invitationId: string,
  ): Promise<{ organization: { id: string; name: string } }> => {
    const { data } = await apiClient.post<{ organization: { id: string; name: string } }>(
      endpoints.invitations.acceptMine(invitationId),
    );
    return data;
  },

  /** POST /me/invitations/:id/decline — records WHO declined, unlike the token flow. */
  declineMine: async (invitationId: string): Promise<void> => {
    await apiClient.post(endpoints.invitations.declineMine(invitationId));
  },

  /** GET /organizations/:orgId/invitations — pending + declined (owner/admin). */
  listForOrg: async (orgId: string): Promise<Invitation[]> => {
    const { data } = await apiClient.get<{ invitations: Invitation[] }>(
      endpoints.invitations.forOrg(orgId),
    );
    return data.invitations;
  },

  /** POST /organizations/:orgId/invitations — send an invite (owner/admin). The
   * permission template is required and must be one the owner created (there are
   * no defaults); the role is a job title and optional. */
  create: async (
    orgId: string,
    body: { email: string; roleId?: string; permissionTemplateId: string },
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
