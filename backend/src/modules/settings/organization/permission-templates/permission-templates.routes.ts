import { Router } from 'express';
import { authenticate } from '../../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../../middlewares/authorize.ts';
import { validateBody } from '../../../../middlewares/validate.ts';
import { createTemplateSchema, updateTemplateSchema } from './permission-templates.schemas.ts';
import * as controller from './permission-templates.controller.ts';

/**
 * Mounted at `/organizations/:orgId/permission-templates` (routes/index.ts).
 * `mergeParams: true` so the nested router sees `:orgId`; authenticate →
 * tenantContext verifies membership AND resolves the caller's permission set
 * before any handler. This module dogfoods its own gate: reads need `role:read`,
 * writes need the matching `role:create` / `role:update` / `role:delete` (all
 * owner-only in the seeded templates).
 */
const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

// `/catalog` before `/:id` so it isn't captured as an id.
router.get('/catalog', requirePermission('role:read'), controller.getCatalog);

router.get('/', requirePermission('role:read'), controller.getTemplates);
router.get('/:id', requirePermission('role:read'), controller.getOneTemplate);

router.post(
  '/',
  requirePermission('role:create'),
  validateBody(createTemplateSchema),
  controller.postTemplate,
);
router.put(
  '/:id',
  requirePermission('role:update'),
  validateBody(updateTemplateSchema),
  controller.putTemplate,
);
router.delete('/:id', requirePermission('role:delete'), controller.removeTemplate);

export { router as permissionTemplatesRouter };
