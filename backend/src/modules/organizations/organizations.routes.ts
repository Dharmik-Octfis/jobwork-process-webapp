import { Router } from 'express';
import { z } from 'zod';
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

import { openApiRegistry } from '../../config/openapi.ts';
import { createOrganizationSchema, updateOrganizationSchema } from './organizations.schemas.ts';

openApiRegistry.registerPath({
  method: 'post',
  path: '/organizations',
  tags: ['Organizations'],
  summary: 'Create a new organization',
  request: {
    body: {
      content: { 'application/json': { schema: createOrganizationSchema } },
    },
  },
  responses: {
    201: { description: 'Organization created successfully' },
    400: { description: 'Validation failed' },
    401: { description: 'Unauthorized' },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations',
  tags: ['Organizations'],
  summary: 'Get all organizations for current user',
  responses: {
    200: { description: 'List of organizations' },
    401: { description: 'Unauthorized' },
  },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/organizations/{id}',
  tags: ['Organizations'],
  summary: 'Update an organization',
  request: {
    params: z.object({
      id: z.string().openapi({ description: 'Organization ID' }),
    }),
    body: {
      content: { 'application/json': { schema: updateOrganizationSchema } },
    },
  },
  responses: {
    200: { description: 'Organization updated successfully' },
    400: { description: 'Validation failed' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/organizations/{id}',
  tags: ['Organizations'],
  summary: 'Delete an organization',
  request: {
    params: z.object({
      id: z.string().openapi({ description: 'Organization ID' }),
    }),
  },
  responses: {
    200: { description: 'Organization deleted successfully' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

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
