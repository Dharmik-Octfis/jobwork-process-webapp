import { Router } from 'express';
import { authenticate } from '../../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../../middlewares/tenantContext.ts';
import { validateBody } from '../../../../middlewares/validate.ts';
import {
  createDefinitionSchema,
  reorderSchema,
  updateDefinitionSchema,
} from './custom-fields.schemas.ts';
import * as controller from './custom-fields.controller.ts';

/**
 * Mounted at `/organizations/:orgId/custom-fields` (routes/index.ts).
 * `mergeParams: true` so the nested router sees `:orgId`; authenticate → tenantContext
 * verifies membership before any handler. Admin-only writes are gated in the service
 * via assertOrgAdmin.
 */
const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

// Active fields for a record form (any member).
router.get('/', controller.getActiveDefinitions);

// Admin manager.
router.get('/definitions', controller.getDefinitions);
router.post('/definitions', validateBody(createDefinitionSchema), controller.createDefinition);
// `reorder` before `/:id` so it isn't captured as an id.
router.put('/definitions/reorder', validateBody(reorderSchema), controller.reorderDefinitions);
router.put('/definitions/:id', validateBody(updateDefinitionSchema), controller.updateDefinition);
router.post('/definitions/:id/archive', controller.archiveDefinition);

export { router as customFieldsRouter };
