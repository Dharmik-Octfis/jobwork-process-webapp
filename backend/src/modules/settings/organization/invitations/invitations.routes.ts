import { Router } from 'express';
import { optionalAuthenticate } from '../../../../middlewares/optionalAuthenticate.ts';
import { validateBody } from '../../../../middlewares/validate.ts';
import * as invitationsController from './invitations.controller.ts';
import { acceptInvitationSchema } from './invitations.schemas.ts';

/**
 * Public invitation routes — no `authenticate`, because the whole point is to
 * serve people who may not have an account yet. The raw token in the path is the
 * credential.
 */
export const invitationsRouter = Router();

// Look up an invite so the accept page can render (valid? which org? account?).
invitationsRouter.get('/:token', invitationsController.getByToken);

// Accept. `optionalAuthenticate` attaches req.user if a Bearer token is sent, so
// the same endpoint handles a logged-in acceptor and an anonymous new signup.
invitationsRouter.post(
  '/:token/accept',
  optionalAuthenticate,
  validateBody(acceptInvitationSchema),
  invitationsController.accept,
);
