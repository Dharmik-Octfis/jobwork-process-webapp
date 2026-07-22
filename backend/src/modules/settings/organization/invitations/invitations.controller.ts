import type { Request, Response } from 'express';
import { ApiError } from '../../../../lib/apiError.ts';
import { setRefreshTokenAsCookie } from '../../../../lib/cookies.ts';
import * as invitationsService from './invitations.service.ts';
import type { CreateInvitationInput, AcceptInvitationInput } from './invitations.schemas.ts';

// ── Org-scoped management (mounted under /organizations/:id, requires auth) ────

export async function createInvitation(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'Sign in to continue.');
  const organizationId = req.params.id as string;

  const invitation = await invitationsService.createInvitation(
    req.user.id,
    organizationId,
    req.body as CreateInvitationInput,
  );

  res.status(201).json({ invitation });
}

export async function listInvitations(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'Sign in to continue.');
  const organizationId = req.params.id as string;

  const invitations = await invitationsService.listInvitations(req.user.id, organizationId);
  res.status(200).json({ invitations });
}

export async function revokeInvitation(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'Sign in to continue.');
  const organizationId = req.params.id as string;
  const invitationId = req.params.invitationId as string;

  await invitationsService.revokeInvitation(req.user.id, organizationId, invitationId);
  res.status(200).json({ message: 'Invitation revoked.' });
}

// ── Public accept flow (mounted under /invitations/:token) ────────────────────

export async function getByToken(req: Request, res: Response): Promise<void> {
  const token = req.params.token as string;
  const invitation = await invitationsService.getInvitationByToken(token);
  res.status(200).json({ invitation });
}

export async function accept(req: Request, res: Response): Promise<void> {
  const token = req.params.token as string;
  // `optionalAuthenticate` sets req.user when a valid Bearer token is present.
  const currentUserId = req.user?.id ?? null;

  const result = await invitationsService.acceptInvitation(
    token,
    currentUserId,
    req.body as AcceptInvitationInput,
  );

  // A brand-new user was created during accept — sign them in exactly like signup:
  // refresh token as httpOnly cookie, access token in the body.
  if (result.autoLogin) {
    setRefreshTokenAsCookie(res, result.autoLogin.refreshToken);
    res.status(201).json({
      organization: result.organization,
      role: result.role,
      user: result.autoLogin.user,
      accessToken: result.autoLogin.accessToken,
    });
    return;
  }

  res.status(200).json({ organization: result.organization, role: result.role });
}
