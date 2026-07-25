import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../../middlewares/tenantContext.ts';
import { requireOwner, requirePermission } from '../../../../middlewares/authorize.ts';

import {
  createOrganization,
  getOrganizations,
  updateOrganization,
  deleteOrganization,
} from './organizations.controller.ts';

import { openApiRegistry } from '../../../../config/openapi.ts';
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

// Not org-scoped: you create an org before you belong to one, and you list orgs
// before picking one. No tenantContext here — there is no tenant yet.
organizationsRouter.post('/', createOrganization);
organizationsRouter.get('/', getOrganizations);

// These two DO act on one organization, so they take the full chain. The param is
// `:orgId` because that is the name tenantContext reads.
//
// Editing the profile is a normal permission. Deleting is `requireOwner` and is
// deliberately NOT in the permission catalog: whoever holds
// `permission_template:update` can grant themselves any permission, so the only
// way to keep destroying the organization owner-exclusive is a gate no template
// can satisfy.
organizationsRouter.put(
  '/:orgId',
  tenantContext,
  requirePermission('organization:update'),
  updateOrganization,
);
organizationsRouter.delete('/:orgId', tenantContext, requireOwner, deleteOrganization);

// Org-scoped invite management moved to `/organizations/:orgId/invitations`
// (invitations.routes.ts → orgInvitationsRouter), so it can mount tenantContext
// and carry a real `requirePermission` instead of the old assertOrgAdmin check.
// The public accept flow lives at /api/invitations/:token.
