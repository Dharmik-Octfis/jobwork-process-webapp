import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';
import {
  saveZohoConfig,
  getZohoConnectUrl,
  handleOAuthCallback,
  getIntegrationStatus,
  getZohoOrganizations,
  saveSelectedOrganization,
  disconnectZoho,
  refreshZohoToken,
  getEntityFields,
  getSyncSettings,
  saveSyncConfig,
  toggleSync,
  instantSync,
  syncAllModules,
  getSyncHistory,
} from './zoho.controller.ts';
import {
  configureZohoCredentialsSchema,
  selectZohoOrganizationSchema,
  saveZohoSyncConfigSchema,
  toggleZohoSyncSchema,
  instantZohoSyncSchema,
} from './zoho.schemas.ts';

/**
 * Tenant-scoped Zoho Books integration router.
 * Mounted at `/organizations/:orgId/settings/integrations/zoho`
 */
const zohoRouter = Router({ mergeParams: true });

zohoRouter.use(authenticate, tenantContext);

zohoRouter.get('/status', requirePermission('integration:read'), getIntegrationStatus);
zohoRouter.post(
  '/configure',
  requirePermission('integration:update'),
  validateBody(configureZohoCredentialsSchema),
  saveZohoConfig,
);
zohoRouter.get('/connect', requirePermission('integration:update'), getZohoConnectUrl);
zohoRouter.post('/authorize', requirePermission('integration:update'), getZohoConnectUrl);
zohoRouter.get('/organizations', requirePermission('integration:read'), getZohoOrganizations);
zohoRouter.post(
  '/organization',
  requirePermission('integration:update'),
  validateBody(selectZohoOrganizationSchema),
  saveSelectedOrganization,
);
zohoRouter.post(
  '/select-organization',
  requirePermission('integration:update'),
  validateBody(selectZohoOrganizationSchema),
  saveSelectedOrganization,
);
zohoRouter.post('/disconnect', requirePermission('integration:delete'), disconnectZoho);
zohoRouter.post('/refresh', requirePermission('integration:update'), refreshZohoToken);

// Synchronize & Field Mapping Routes
zohoRouter.get('/fields', requirePermission('integration:read'), getEntityFields);
zohoRouter.get('/sync', requirePermission('integration:read'), getSyncSettings);
zohoRouter.post(
  '/sync/configure',
  requirePermission('integration:update'),
  validateBody(saveZohoSyncConfigSchema),
  saveSyncConfig,
);
zohoRouter.post(
  '/sync/toggle',
  requirePermission('integration:update'),
  validateBody(toggleZohoSyncSchema),
  toggleSync,
);
zohoRouter.post(
  '/sync/instant',
  requirePermission('integration:update'),
  validateBody(instantZohoSyncSchema),
  instantSync,
);
zohoRouter.post(
  '/sync/all',
  requirePermission('integration:update'),
  syncAllModules,
);
zohoRouter.get('/sync/history', requirePermission('integration:read'), getSyncHistory);

/**
 * Public OAuth callback router.
 * Mounted at `/api/integrations/zoho` (handles `/api/integrations/zoho/callback`)
 */
const zohoCallbackRouter = Router();
zohoCallbackRouter.get('/callback', handleOAuthCallback);

export { zohoRouter, zohoCallbackRouter };
