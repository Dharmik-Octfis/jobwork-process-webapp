import { Router } from 'express';
import { authenticate } from '../../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../../middlewares/authorize.ts';
import { validateBody } from '../../../../middlewares/validate.ts';
import { updateMemberSchema } from './members.schemas.ts';
import * as controller from './members.controller.ts';

/**
 * Mounted at `/organizations/:orgId/members` (routes/index.ts).
 * `mergeParams: true` so the nested router sees `:orgId`; authenticate →
 * tenantContext verifies membership and resolves permissions before any handler.
 *
 * This is where a member is given a job title and an access bundle — two separate
 * fields, set independently. Permissions are never edited per user: you assign a
 * different template. See docs/ROLES_AND_PERMISSIONS.md.
 */
const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', requirePermission('member:read'), controller.getMembers);
router.put(
  '/:id',
  requirePermission('member:update'),
  validateBody(updateMemberSchema),
  controller.putMember,
);
router.delete('/:id', requirePermission('member:delete'), controller.deleteMember);

export { router as membersRouter };
