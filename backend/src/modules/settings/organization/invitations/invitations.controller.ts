import type { Request, Response } from 'express';
import { ApiError } from '../../../../lib/apiError.ts';
import { sendSuccess } from '../../../../lib/apiResponse.ts';
import { setRefreshTokenAsCookie } from '../../../../lib/cookies.ts';
import * as invitationsService from './invitations.service.ts';
import type { CreateInvitationInput, AcceptInvitationInput } from './invitations.schemas.ts';

// ── Org-scoped management (mounted under /organizations/:id, requires auth) ────

export async function createInvitation(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'Sign in to continue.');
  // `req.tenantId`, never `req.params` — only tenantContext's copy has been
  // membership-checked (CLAUDE.md).
  const organizationId = req.tenantId!;

  const invitation = await invitationsService.createInvitation(
    req.user.id,
    organizationId,
    req.body as CreateInvitationInput,
  );

  // `data` keeps the { invitation } shape the client already reads — the web
  // interceptor unwraps the envelope and hands this inner object to feature code.
  sendSuccess(res, { invitation }, 'Invitation sent.', 201);
}

export async function listInvitations(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'Sign in to continue.');
  const organizationId = req.tenantId!;

  const invitations = await invitationsService.listInvitations(organizationId);
  sendSuccess(res, { invitations });
}

export async function revokeInvitation(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'Sign in to continue.');
  const organizationId = req.tenantId!;
  const invitationId = req.params.invitationId as string;

  await invitationsService.revokeInvitation(req.user.id, organizationId, invitationId);
  sendSuccess(res, null, 'Invitation revoked.');
}

// ── Public accept flow (mounted under /invitations/:token) ────────────────────

export async function getByToken(req: Request, res: Response): Promise<void> {
  const token = req.params.token as string;
  const invitation = await invitationsService.getInvitationByToken(token);
  sendSuccess(res, { invitation });
}

// ── The recipient's inbox (mounted under /me/invitations, requires auth) ──────
//
// Addressed by invitation id, not token: the raw token lives only in the email
// and cannot be recovered from its hash. Authorization is the session plus an
// email match, enforced in the service.

export async function listMine(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'Sign in to continue.');
  const invitations = await invitationsService.listMyInvitations(req.user.id);
  sendSuccess(res, { invitations });
}

export async function acceptMine(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'Sign in to continue.');
  const result = await invitationsService.acceptMyInvitation(req.user.id, req.params.id as string);
  // Always already signed in here, so there is never an autoLogin to issue.
  sendSuccess(
    res,
    {
      organization: result.organization,
      roleName: result.roleName,
      permissionTemplateName: result.permissionTemplateName,
    },
    'Invitation accepted.',
  );
}

export async function declineMine(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'Sign in to continue.');
  await invitationsService.declineMyInvitation(req.user.id, req.params.id as string);
  sendSuccess(res, null, 'Invitation declined.');
}

/** Decline an invite. Public — the raw token is the credential, and the invitee
 * may have no account (so no session to authenticate). */
export async function decline(req: Request, res: Response): Promise<void> {
  const token = req.params.token as string;
  await invitationsService.declineInvitation(token);
  sendSuccess(res, null, 'Invitation declined.');
}

export async function accept(req: Request, res: Response): Promise<void> {
  const token = req.params.token as string;
  // `optionalAuthenticate` sets req.user when a valid Bearer token is present.
  const currentUserId = req.user?.id ?? null;
  const userAgent = req.get('user-agent') ?? 'unknown';

  const result = await invitationsService.acceptInvitation(
    token,
    currentUserId,
    req.body as AcceptInvitationInput,
    userAgent,
  );

  // A brand-new user was created during accept — sign them in exactly like signup:
  // refresh token as httpOnly cookie, access token in the body.
  if (result.autoLogin) {
    setRefreshTokenAsCookie(res, result.autoLogin.refreshToken);
    sendSuccess(
      res,
      {
        organization: result.organization,
        roleName: result.roleName,
        permissionTemplateName: result.permissionTemplateName,
        user: result.autoLogin.user,
        accessToken: result.autoLogin.accessToken,
      },
      'Invitation accepted.',
      201,
    );
    return;
  }

  sendSuccess(
    res,
    {
      organization: result.organization,
      roleName: result.roleName,
      permissionTemplateName: result.permissionTemplateName,
    },
    'Invitation accepted.',
  );
}
