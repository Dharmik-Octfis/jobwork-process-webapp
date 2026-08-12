import { Router } from 'express';
import { validateBody } from '../../../middlewares/validate.js';
import { createAssemblySchema } from './assemblies.schemas.js';
import {
  createAssembly,
  getAssemblies,
  getAssemblyById,
  getNumberingPreference,
  setNumberingPreference,
  deleteAssemblyRoute,
  getAssemblyCommentsRoute,
  createAssemblyCommentRoute,
  deleteAssemblyCommentRoute,
  getAssemblyActivitiesRoute,
} from './assemblies.controller.js';
import { requirePermission } from '../../../middlewares/authorize.js';
import { tenantContext } from '../../../middlewares/tenantContext.js';
import { authenticate } from '../../../middlewares/authenticate.js';

const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', requirePermission('assembly:read'), getAssemblies);
router.get('/number-preference', requirePermission('assembly:read'), getNumberingPreference);
router.get('/:id', requirePermission('assembly:read'), getAssemblyById);
router.put('/number-preference', requirePermission('assembly:update'), setNumberingPreference);
router.post(
  '/',
  requirePermission('assembly:create'),
  validateBody(createAssemblySchema),
  createAssembly,
);
router.delete('/:id', requirePermission('assembly:delete'), deleteAssemblyRoute);

router.get('/:id/activities', requirePermission('assembly:read'), getAssemblyActivitiesRoute);

router.get('/:id/comments', requirePermission('assembly:read'), getAssemblyCommentsRoute);
router.post('/:id/comments', requirePermission('assembly:update'), createAssemblyCommentRoute);
router.delete(
  '/:id/comments/:commentId',
  requirePermission('assembly:update'),
  deleteAssemblyCommentRoute,
);

export const assembliesRouter = router;
