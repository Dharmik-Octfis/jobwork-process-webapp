import { Router } from 'express';
import { authenticate } from '../../../../middlewares/authenticate.ts';
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

// Decline. No auth and no body — holding the token is the entire credential, the
// same as accept. Lets the invitee say "no" instead of the invite expiring silently.
invitationsRouter.post('/:token/decline', invitationsController.decline);

/**
 * The recipient's inbox — mounted at `/me/invitations` (routes/index.ts).
 *
 * Separate router because the trust model is the opposite of the one above: these
 * routes REQUIRE a session and address invitations by **id**, never by token. The
 * raw token exists only in the email (we store just its hash), so the app can
 * never hand it back to the UI — the session plus an email match replaces it, and
 * is a stronger claim than "whoever holds this string".
 *
 * This is what answers "I lost the invitation email, where do I find it?".
 */
export const myInvitationsRouter = Router();

myInvitationsRouter.use(authenticate);

myInvitationsRouter.get('/', invitationsController.listMine);
myInvitationsRouter.post('/:id/accept', invitationsController.acceptMine);
myInvitationsRouter.post('/:id/decline', invitationsController.declineMine);
