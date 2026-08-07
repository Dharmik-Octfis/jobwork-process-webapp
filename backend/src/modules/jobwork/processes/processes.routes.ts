import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';
import { createProcessSchema, updateProcessSchema } from './processes.schemas.ts';
import {
  createProcess,
  deleteProcess,
  getProcess,
  getProcessCount,
  getProcesses,
  updateProcess,
} from './processes.controller.ts';

/**
 * Mounted at `/organizations/:orgId/jobwork/processes` (routes/index.ts).
 *
 * `mergeParams: true` is load-bearing: without it this nested router cannot see
 * the parent's `:orgId`, `req.params.orgId` is undefined, and `tenantContext`
 * 400s every request.
 */
const router = Router({ mergeParams: true });

// Order matters. `authenticate` establishes who you are; `tenantContext` then
// proves you belong to the organization named in the URL and promotes `:orgId`
// to `req.tenantId`; only then can `requirePermission` ask what you may do.
router.use(authenticate, tenantContext);

/**
 * 🔴 EVERY route carries a `requirePermission`. Forgetting the catalog entry
 * fails closed — nobody can act, and you hear about it immediately. Forgetting
 * one of these fails OPEN AND SILENTLY: the route has no gate, every member of
 * the org can do it, and nothing warns you. Same shape as a tenant table with no
 * RLS policy.
 */
router.get('/', requirePermission('process:read'), getProcesses);
router.post(
  '/',
  requirePermission('process:create'),
  validateBody(createProcessSchema),
  createProcess,
);

// Before '/:id' — otherwise '/count' is captured as a process id.
router.get('/count', requirePermission('process:read'), getProcessCount);

router.get('/:id', requirePermission('process:read'), getProcess);
router.put(
  '/:id',
  requirePermission('process:update'),
  validateBody(updateProcessSchema),
  updateProcess,
);
router.delete('/:id', requirePermission('process:delete'), deleteProcess);

export { router as processesRouter };
