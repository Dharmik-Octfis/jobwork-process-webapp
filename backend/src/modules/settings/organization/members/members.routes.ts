import { Router } from 'express';
import { authenticate } from '../../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../../middlewares/authorize.ts';
import { validateBody } from '../../../../middlewares/validate.ts';
import { updateMemberSchema, updateMyProfileSchema } from './members.schemas.ts';
import * as controller from './members.controller.ts';

/**
 * Mounted at `/organizations/:orgId/members` (routes/index.ts) and surfaced to
 * users as Settings → **Users**. The path stays `/members` deliberately: renaming
 * it would break every existing client for a label change.
 *
 * `mergeParams: true` so the nested router sees `:orgId`; authenticate →
 * tenantContext verifies membership and resolves permissions before any handler.
 *
 * 🔴 TWO DOORS, ON PURPOSE.
 *
 *   PUT /members/me   — editing YOURSELF. No `requirePermission`.
 *   PUT /members/:id  — editing SOMEONE ELSE. `member:update`.
 *
 * `requirePermission` is a pure set check and cannot express "self or permitted",
 * so the distinction lives in the routing table where it is visible, rather than in
 * a bespoke membership lookup inside a service (CLAUDE.md forbids the latter — that
 * was `assertOrgAdmin`). Gating your own name behind `member:update` would fail
 * closed in the worst way: a new joiner could not fix the inviter's typo in their
 * own name without an admin. What keeps `/me` safe is `updateMyProfileSchema`,
 * which does not accept `roleId`, `permissionTemplateId` or `isActive` — the three
 * fields that could promote, grant, or reactivate.
 */
const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', requirePermission('member:read'), controller.getMembers);

// 🔴 Both before `/:id`. Express matches in mount order, so a `/:id` route declared
// first would swallow "me" and "count" and try to load a membership with that id.
router.get('/count', requirePermission('member:read'), controller.getMembersCount);
router.get('/me', controller.getMe);
router.put('/me', validateBody(updateMyProfileSchema), controller.putMe);

router.get('/:id', requirePermission('member:read'), controller.getMemberById);
router.put(
  '/:id',
  requirePermission('member:update'),
  validateBody(updateMemberSchema),
  controller.putMember,
);
router.delete('/:id', requirePermission('member:delete'), controller.deleteMember);

export { router as membersRouter };
