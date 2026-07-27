import { Router } from 'express';
import { authenticate } from '../../../../middlewares/authenticate.js';
import { tenantContext } from '../../../../middlewares/tenantContext.js';
import { requirePermission } from '../../../../middlewares/authorize.js';
import * as ctrl from './locations.controller.js';

export const locationsRouter = Router({ mergeParams: true });

locationsRouter.use(authenticate, tenantContext);

locationsRouter.get('/', requirePermission('location:read'), ctrl.getLocations);
locationsRouter.post('/', requirePermission('location:create'), ctrl.createLocation);
locationsRouter.get('/:id', requirePermission('location:read'), ctrl.getLocation);
locationsRouter.patch('/:id', requirePermission('location:update'), ctrl.updateLocation);
locationsRouter.delete('/:id', requirePermission('location:delete'), ctrl.deleteLocation);
