import type { Request, Response } from 'express';
import { env } from '../../../config/env.ts';
import { prisma } from '../../../db/prisma.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import {
  buildAuthorizationUrl,
  handleCallback,
  getSafeIntegrationStatus,
  saveZohoCredentials,
  disconnectIntegration,
} from './zoho.oauth.service.ts';
import { getValidAccessToken } from './zoho.token.service.ts';
import {
  fetchZohoOrganizations,
  saveSelectedZohoOrganization,
  fetchZohoEntityFields,
  getZohoSyncSettings,
  saveZohoSyncConfig,
  toggleZohoSync,
  executeInstantSync,
  executeAllZohoSync,
  getZohoSyncHistory,
} from './zoho.api.service.ts';
import type {
  SelectZohoOrganizationInput,
  ConfigureZohoCredentialsInput,
  SaveZohoSyncConfigInput,
  ToggleZohoSyncInput,
  InstantZohoSyncInput,
} from './zoho.schemas.ts';

/**
 * POST /organizations/:orgId/settings/integrations/zoho/configure
 * Save organization-specific Zoho Client ID and Client Secret.
 */
export async function saveZohoConfig(req: Request, res: Response): Promise<void> {
  const body = req.body as ConfigureZohoCredentialsInput;
  const status = await saveZohoCredentials(
    req.tenantId!,
    body.client_id,
    body.client_secret,
    body.data_center,
    body.accounts_server,
    req.user?.id,
  );
  sendSuccess(res, status, 'Zoho credentials saved successfully.');
}

/**
 * GET /organizations/:orgId/settings/integrations/zoho/connect
 * or POST /organizations/:orgId/settings/integrations/zoho/authorize
 * Generate secure authorization URL for the user to initiate Zoho OAuth.
 */
export async function getZohoConnectUrl(req: Request, res: Response): Promise<void> {
  const accountsServer =
    typeof req.query['accounts_server'] === 'string' ? req.query['accounts_server'] : undefined;
  const returnTo = typeof req.query['return_to'] === 'string' ? req.query['return_to'] : undefined;

  const result = await buildAuthorizationUrl(
    req.tenantId!,
    req.user!.id,
    accountsServer,
    returnTo,
  );

  sendSuccess(res, result);
}

/**
 * GET /api/integrations/zoho/callback
 * Handle redirect from Zoho Accounts after user consent.
 */
export async function handleOAuthCallback(req: Request, res: Response): Promise<void> {
  const code = typeof req.query['code'] === 'string' ? req.query['code'] : undefined;
  const state = typeof req.query['state'] === 'string' ? req.query['state'] : undefined;
  const error = typeof req.query['error'] === 'string' ? req.query['error'] : undefined;
  const errorDesc =
    typeof req.query['error_description'] === 'string'
      ? req.query['error_description']
      : undefined;
  const accountsServer =
    typeof req.query['accounts-server'] === 'string'
      ? req.query['accounts-server']
      : typeof req.query['accounts_server'] === 'string'
        ? req.query['accounts_server']
        : undefined;
  const location = typeof req.query['location'] === 'string' ? req.query['location'] : undefined;

  // Handle user denial or OAuth error returned from Zoho
  if (error || !code) {
    let targetOrgId: string | null = null;
    if (state) {
      const stateRecord = await prisma.oAuthState
        .findUnique({ where: { state } })
        .catch(() => null);
      if (stateRecord) {
        targetOrgId = stateRecord.organizationId;
        await prisma.oAuthState.delete({ where: { id: stateRecord.id } }).catch(() => {});
      }
    }

    const message =
      error === 'access_denied'
        ? 'Zoho authorization was cancelled or denied.'
        : errorDesc || error || 'Zoho authorization failed.';

    const redirectUrl = targetOrgId
      ? `${env.appUrl}/integrations/zoho/callback?status=error&orgId=${targetOrgId}&error=${encodeURIComponent(message)}`
      : `${env.appUrl}/integrations/zoho/callback?status=error&error=${encodeURIComponent(message)}`;

    res.redirect(redirectUrl);
    return;
  }

  try {
    const { organizationId } = await handleCallback(code, state!, accountsServer, location);
    res.redirect(
      `${env.appUrl}/integrations/zoho/callback?status=authorized&orgId=${organizationId}`,
    );
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : 'Unable to complete Zoho authorization.';
    let targetOrgId: string | null = null;
    if (state) {
      const stateRecord = await prisma.oAuthState
        .findUnique({ where: { state } })
        .catch(() => null);
      targetOrgId = stateRecord?.organizationId || null;
    }

    const redirectUrl = targetOrgId
      ? `${env.appUrl}/integrations/zoho/callback?status=error&orgId=${targetOrgId}&error=${encodeURIComponent(errorMessage)}`
      : `${env.appUrl}/integrations/zoho/callback?status=error&error=${encodeURIComponent(errorMessage)}`;

    res.redirect(redirectUrl);
  }
}

/**
 * GET /organizations/:orgId/settings/integrations/zoho/status
 * Return current safe integration status (connected/disconnected/authorized, org name, masked credentials, etc.)
 */
export async function getIntegrationStatus(req: Request, res: Response): Promise<void> {
  const status = await getSafeIntegrationStatus(req.tenantId!);
  sendSuccess(res, status);
}

/**
 * GET /organizations/:orgId/settings/integrations/zoho/organizations
 * Fetch available Zoho Books organizations from Zoho API.
 */
export async function getZohoOrganizations(req: Request, res: Response): Promise<void> {
  const orgs = await fetchZohoOrganizations(req.tenantId!);
  sendSuccess(res, orgs);
}

/**
 * POST /organizations/:orgId/settings/integrations/zoho/organization
 * Save the user's selected Zoho Books organization.
 */
export async function saveSelectedOrganization(req: Request, res: Response): Promise<void> {
  const body = req.body as SelectZohoOrganizationInput;
  const result = await saveSelectedZohoOrganization(
    req.tenantId!,
    body.organization_id,
    req.user?.id,
  );
  sendSuccess(res, result, 'Zoho Books connected successfully.');
}

/**
 * POST /organizations/:orgId/settings/integrations/zoho/disconnect
 * Disconnect and remove stored Zoho Books credentials.
 */
export async function disconnectZoho(req: Request, res: Response): Promise<void> {
  await disconnectIntegration(req.tenantId!, req.user?.id);
  sendSuccess(res, null, 'Zoho Books disconnected successfully.');
}

/**
 * POST /organizations/:orgId/settings/integrations/zoho/refresh
 * Explicitly test or refresh access token.
 */
export async function refreshZohoToken(req: Request, res: Response): Promise<void> {
  await getValidAccessToken(req.tenantId!);
  sendSuccess(res, null, 'Zoho Books connection verified and refreshed successfully.');
}

/**
 * GET /organizations/:orgId/settings/integrations/zoho/fields?entity=:entity
 * Fetch Zoho Books fields and application fields for mapping.
 */
export async function getEntityFields(req: Request, res: Response): Promise<void> {
  const entity = typeof req.query['entity'] === 'string' ? req.query['entity'] : 'item';
  const result = await fetchZohoEntityFields(req.tenantId!, entity);
  sendSuccess(res, result);
}

/**
 * GET /organizations/:orgId/settings/integrations/zoho/sync
 * Fetch current synchronization settings and module statuses.
 */
export async function getSyncSettings(req: Request, res: Response): Promise<void> {
  const settings = await getZohoSyncSettings(req.tenantId!);
  sendSuccess(res, settings);
}

/**
 * POST /organizations/:orgId/settings/integrations/zoho/sync/configure
 * Save / Update synchronization preferences and field mappings.
 */
export async function saveSyncConfig(req: Request, res: Response): Promise<void> {
  const body = req.body as SaveZohoSyncConfigInput;
  const result = await saveZohoSyncConfig(req.tenantId!, body, req.user?.id);
  sendSuccess(res, result, `${result.moduleLabel} sync settings saved successfully.`);
}

/**
 * POST /organizations/:orgId/settings/integrations/zoho/sync/toggle
 * Toggle Pause / Resume for module synchronization.
 */
export async function toggleSync(req: Request, res: Response): Promise<void> {
  const { module, active, status } = req.body as ToggleZohoSyncInput;
  const result = await toggleZohoSync(req.tenantId!, module, active, status, req.user?.id);
  const statusMsg = result.status === 'ACTIVE' ? 'activated' : result.status === 'PAUSED' ? 'paused' : 'set to inactive';
  sendSuccess(
    res,
    result,
    `Sync for ${result.moduleLabel} has been ${statusMsg}.`,
  );
}

/**
 * POST /organizations/:orgId/settings/integrations/zoho/sync/instant
 * Trigger manual instant or full sync for a specific module or all active modules.
 */
export async function instantSync(req: Request, res: Response): Promise<void> {
  const { module, fullSync, syncMode, syncAddresses, syncContactPersons } = req.body as InstantZohoSyncInput;
  const syncOptions = { fullSync, syncMode, syncAddresses, syncContactPersons };

  if (!module || module === 'all') {
    const result = await executeAllZohoSync(req.tenantId!, req.user?.id, syncOptions);
    sendSuccess(res, result, result.message);
    return;
  }
  const result = await executeInstantSync(req.tenantId!, module, req.user?.id, syncOptions);
  sendSuccess(res, result, result.message);
}

/**
 * POST /organizations/:orgId/settings/integrations/zoho/sync/all
 * Trigger common / all-modules synchronization (supports fullSync/syncMode in body).
 */
export async function syncAllModules(req: Request, res: Response): Promise<void> {
  const body = (req.body || {}) as InstantZohoSyncInput;
  const syncOptions = {
    fullSync: body.fullSync,
    syncMode: body.syncMode,
    syncAddresses: body.syncAddresses,
    syncContactPersons: body.syncContactPersons,
  };
  const result = await executeAllZohoSync(req.tenantId!, req.user?.id, syncOptions);
  sendSuccess(res, result, result.message);
}

/**
 * GET /organizations/:orgId/settings/integrations/zoho/sync/history
 * Fetch sync logs and history.
 */
export async function getSyncHistory(req: Request, res: Response): Promise<void> {
  const module = typeof req.query['module'] === 'string' ? (req.query['module'] as any) : undefined;
  const logs = await getZohoSyncHistory(req.tenantId!, module);
  sendSuccess(res, logs);
}
