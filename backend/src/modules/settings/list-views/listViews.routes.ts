import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { isListEntityType } from './listViews.catalog.ts';
import { getListViewRoute, saveListViewRoute, saveListViewSchema } from './listViews.controller.ts';

/**
 * Mounted at `/organizations/:orgId/list-views` (routes/index.ts).
 * `mergeParams: true` so `:orgId` from the parent is visible to tenantContext.
 */
const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

/**
 * A column layout is not its own permission: it is a view of a module you can
 * already read, so it borrows that module's `read` permission. `:entityType`
 * lives in the path, so the permission is resolved per request and delegated to
 * the normal `requirePermission` middleware.
 *
 * Deriving it (rather than inventing a `list-view:*` resource) means a member who
 * can see Vendors can always customise the Vendors list — no separate grant to
 * forget, and no way to customise a module you cannot read.
 */
function requireEntityRead(req: Request, res: Response, next: NextFunction): void {
  const entityType = req.params.entityType;
  if (typeof entityType !== 'string' || !isListEntityType(entityType)) {
    next(ApiError.badRequest('Unknown module.'));
    return;
  }
  // Map list entity types to permission resources if they differ.
  const permissionMap: Record<string, string> = {
    item_assembly: 'assembly',
  };
  const permResource = permissionMap[entityType] || entityType;

  // vendor -> 'vendor:read', item -> 'item:read', item_assembly -> 'assembly:read'
  requirePermission(`${permResource}:read`)(req, res, next);
}

router.get('/:entityType', requireEntityRead, getListViewRoute);
router.put('/:entityType', requireEntityRead, validateBody(saveListViewSchema), saveListViewRoute);

export { router as listViewsRouter };
