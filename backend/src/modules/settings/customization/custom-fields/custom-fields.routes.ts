import { Router } from 'express';
import { authenticate } from '../../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../../middlewares/authorize.ts';
import { validateBody } from '../../../../middlewares/validate.ts';
import {
  createDefinitionSchema,
  reorderSchema,
  updateDefinitionSchema,
} from './custom-fields.schemas.ts';
import * as controller from './custom-fields.controller.ts';

/**
 * Mounted at `/organizations/:orgId/custom-fields` (routes/index.ts).
 * `mergeParams: true` so the nested router sees `:orgId`; authenticate →
 * tenantContext verifies membership AND resolves permissions before any handler.
 * The manager routes are gated on `custom_field:*` — until 2026-07-25 they called
 * `assertOrgAdmin` in the service instead, which ignored the permission catalog.
 */
const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

// 🔴 Deliberately ungated beyond membership: this is what the vendor/item/customer
// forms call to know which extra inputs to render. Gating it on `custom_field:read`
// would break every create form for any member whose template omits that key — and
// it would present as an unrelated bug in the vendor module, not here. Reading the
// *shape* of a form you are allowed to fill in is part of filling it in.
router.get('/', controller.getActiveDefinitions);

// The Settings → Modules manager, where the definitions themselves are edited.
router.get('/definitions', requirePermission('custom_field:read'), controller.getDefinitions);
router.post(
  '/definitions',
  requirePermission('custom_field:create'),
  validateBody(createDefinitionSchema),
  controller.createDefinition,
);
// `reorder` before `/:id` so it isn't captured as an id.
router.put(
  '/definitions/reorder',
  requirePermission('custom_field:update'),
  validateBody(reorderSchema),
  controller.reorderDefinitions,
);
router.put(
  '/definitions/:id',
  requirePermission('custom_field:update'),
  validateBody(updateDefinitionSchema),
  controller.updateDefinition,
);
// Archiving IS the delete for a definition — values stay in the DB, so there is no
// hard delete to gate separately.
router.post(
  '/definitions/:id/archive',
  requirePermission('custom_field:delete'),
  controller.archiveDefinition,
);

export { router as customFieldsRouter };
