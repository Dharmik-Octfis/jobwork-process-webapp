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
 * before any handler. This module dogfoods its own gate: reads need
 * `permission_template:read`, writes the matching create/update/delete.
 *
 * NOT `role:*` — that gates job titles now (`roles.routes.ts`). Rewriting a
 * permission template is privilege escalation; renaming a title is not, so the
 * two are separately grantable.
 */
const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

// 🔴 Both before `/:id`. Express matches in mount order, so a `/:id` route
// declared first would swallow "catalog" and "count" and try to load a template
// with that id.
router.get('/catalog', requirePermission('permission_template:read'), controller.getCatalog);
router.get('/count', requirePermission('permission_template:read'), controller.getTemplatesCount);

router.get('/', requirePermission('permission_template:read'), controller.getTemplates);
router.get('/:id', requirePermission('permission_template:read'), controller.getOneTemplate);

router.post(
  '/',
  requirePermission('permission_template:create'),
  validateBody(createTemplateSchema),
  controller.postTemplate,
);
router.put(
  '/:id',
  requirePermission('permission_template:update'),
  validateBody(updateTemplateSchema),
  controller.putTemplate,
);
router.delete('/:id', requirePermission('permission_template:delete'), controller.removeTemplate);

export { router as permissionTemplatesRouter };
