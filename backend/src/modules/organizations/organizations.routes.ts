import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.ts';
import { validateBody } from '../../middlewares/validate.ts';
import {
  createOrganization,
  getOrganizations,
  updateOrganization,
  deleteOrganization,
} from './organizations.controller.ts';
import * as invitationsController from '../invitations/invitations.controller.ts';
import { createInvitationSchema } from '../invitations/invitations.schemas.ts';

export const organizationsRouter = Router();

organizationsRouter.use(authenticate);

organizationsRouter.post('/', createOrganization);
organizationsRouter.get('/', getOrganizations);
organizationsRouter.put('/:id', updateOrganization);
organizationsRouter.delete('/:id', deleteOrganization);

// Member invitations, scoped to an organization (owner/admin only — enforced in
// the service). The public accept flow lives in /api/invitations/:token.
organizationsRouter.post(
  '/:id/invitations',
  validateBody(createInvitationSchema),
  invitationsController.createInvitation,
);
organizationsRouter.get('/:id/invitations', invitationsController.listInvitations);
organizationsRouter.delete(
  '/:id/invitations/:invitationId',
  invitationsController.revokeInvitation,
);
