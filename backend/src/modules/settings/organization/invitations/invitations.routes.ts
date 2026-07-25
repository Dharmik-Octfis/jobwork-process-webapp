import { Router } from 'express';
import { authenticate } from '../../../../middlewares/authenticate.ts';
import { optionalAuthenticate } from '../../../../middlewares/optionalAuthenticate.ts';
import { tenantContext } from '../../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../../middlewares/authorize.ts';
import { validateBody } from '../../../../middlewares/validate.ts';
import * as invitationsController from './invitations.controller.ts';
import { acceptInvitationSchema, createInvitationSchema } from './invitations.schemas.ts';

/**
 * Org-scoped invite management — mounted at `/organizations/:orgId/invitations`
 * (routes/index.ts), BEFORE `/organizations`, so the longer path wins.
 *
 * These routes used to hang off `organizationsRouter` with `authenticate` only,
 * authorized by an `assertOrgAdmin` call inside the service that read the old
 * `memberships.role` string. That was a second, parallel authorization system
 * that ignored the permission catalog entirely: a member holding `member:create`
 * still could not invite anyone. Now it is the same gate as every other module —
 * `tenantContext` verifies membership and resolves permissions, and each route
 * carries one `requirePermission`.
 */
export const orgInvitationsRouter = Router({ mergeParams: true });

orgInvitationsRouter.use(authenticate, tenantContext);

orgInvitationsRouter.get(
  '/',
  requirePermission('member:read'),
  invitationsController.listInvitations,
);
orgInvitationsRouter.post(
  '/',
  requirePermission('member:create'),
  validateBody(createInvitationSchema),
  invitationsController.createInvitation,
);
// Revoking a pending invite is undoing an invitation, not removing a member —
// `member:create` is the power being reversed, so it is what gates this.
orgInvitationsRouter.delete(
  '/:invitationId',
  requirePermission('member:create'),
  invitationsController.revokeInvitation,
);

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
