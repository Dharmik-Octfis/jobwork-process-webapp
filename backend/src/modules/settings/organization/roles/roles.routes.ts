import { Router } from 'express';
import { authenticate } from '../../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../../middlewares/authorize.ts';
import { validateBody } from '../../../../middlewares/validate.ts';
import { createRoleSchema, updateRoleSchema } from './roles.schemas.ts';
import * as controller from './roles.controller.ts';

/**
 * Mounted at `/organizations/:orgId/roles` (routes/index.ts). `mergeParams: true`
 * so the nested router sees `:orgId`; authenticate → tenantContext verifies
 * membership AND resolves the caller's permission set before any handler.
 *
 * Gated on `role:*` — job titles. Editing who may DO what is a different resource
 * (`permission_template:*`) on purpose: handing someone the ability to retitle
 * staff is harmless, handing them the ability to rewrite permissions is privilege
 * escalation. Keeping the two grants separate lets an admin delegate the first
 * without the second.
 */
const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', requirePermission('role:read'), controller.getRoles);
router.get('/:id', requirePermission('role:read'), controller.getOneRole);

router.post(
  '/',
  requirePermission('role:create'),
  validateBody(createRoleSchema),
  controller.postRole,
);
router.put(
  '/:id',
  requirePermission('role:update'),
  validateBody(updateRoleSchema),
  controller.putRole,
);
router.delete('/:id', requirePermission('role:delete'), controller.removeRole);

export { router as rolesRouter };
