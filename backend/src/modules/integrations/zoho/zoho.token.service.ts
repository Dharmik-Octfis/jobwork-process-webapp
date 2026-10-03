import { env } from '../../../config/env.ts';
import { runAsTenant } from '../../../db/prisma.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { encryptToken, decryptToken } from '../../../lib/encryption.ts';
import {
  ZOHO_PROVIDER,
  ZOHO_DEFAULT_ACCOUNTS_URL,
  ZOHO_DEFAULT_API_DOMAIN,
  ZOHO_INTEGRATION_STATUS,
} from './zoho.constants.ts';
import type { ZohoTokenResponse } from './zoho.types.ts';

/**
 * Retrieve a valid access token for the given organization, refreshing automatically if expired.
 * Encrypted tokens are decrypted strictly in memory and never logged or exposed.
 */
export async function getValidAccessToken(
  organizationId: string,
): Promise<{ accessToken: string; apiDomain: string }> {
  const integration = await runAsTenant(organizationId, (tx) =>
    tx.zohoIntegration.findUnique({
      where: { organizationId },
    }),
  );

  if (!integration || integration.isDeleted || !integration.refreshToken) {
    throw new ApiError(401, 'Zoho Books is not connected for this organization.');
  }

  const now = new Date();
  const apiDomain = integration.apiDomain || ZOHO_DEFAULT_API_DOMAIN;

  // 1. If current access token is still valid (with 60-second buffer), decrypt and return
  if (
    integration.accessToken &&
    integration.expiresAt &&
    integration.expiresAt.getTime() > now.getTime() + 60 * 1000
  ) {
    try {
      const decrypted = decryptToken(integration.accessToken);
      if (decrypted) {
        return { accessToken: decrypted, apiDomain };
      }
    } catch {
      // If decryption fails, proceed to token refresh
    }
  }

  // 2. Refresh access token using stored refresh_token and organization credentials
  const accountsServer =
    integration.accountsServer || env.zoho.accountsUrl || ZOHO_DEFAULT_ACCOUNTS_URL;
  const refreshToken = decryptToken(integration.refreshToken);

  const clientId = integration.clientId || env.zoho.clientId;
  const clientSecret = integration.clientSecret
    ? decryptToken(integration.clientSecret)
    : env.zoho.clientSecret;

  if (!clientId || !clientSecret) {
    throw new ApiError(
      400,
      'Zoho Client ID and Client Secret are not configured for this organization.',
    );
  }

  const tokenUrl = `${accountsServer.replace(/\/+$/, '')}/oauth/v2/token`;
  const bodyParams = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  let refreshData: ZohoTokenResponse;
  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: bodyParams.toString(),
    });

    refreshData = (await response.json()) as ZohoTokenResponse;
  } catch (error) {
    console.error('Zoho token refresh network error:', {
      provider: ZOHO_PROVIDER,
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new ApiError(502, 'Unable to connect to Zoho Books right now. Please try again later.');
  }

  if (refreshData.error || !refreshData.access_token) {
    console.error('Zoho token refresh failed:', {
      provider: ZOHO_PROVIDER,
      organizationId,
      error: refreshData.error,
    });

    // Mark status as TOKEN_EXPIRED when refresh fails (e.g. revoked in Zoho)
    await runAsTenant(organizationId, (tx) =>
      tx.zohoIntegration
        .update({
          where: { organizationId },
          data: { status: ZOHO_INTEGRATION_STATUS.TOKEN_EXPIRED },
        })
        .catch(() => {}),
    );

    throw new ApiError(
      401,
      'Zoho authorization has expired or was revoked. Please reconnect your Zoho Books account.',
    );
  }

  const newAccessToken = refreshData.access_token;
  const expiresInSec = refreshData.expires_in || 3600;
  const newExpiresAt = new Date(Date.now() + (expiresInSec - 60) * 1000);
  const updatedApiDomain = refreshData.api_domain || apiDomain;

  await runAsTenant(organizationId, (tx) =>
    tx.zohoIntegration.update({
      where: { organizationId },
      data: {
        accessToken: encryptToken(newAccessToken),
        expiresAt: newExpiresAt,
        apiDomain: updatedApiDomain,
        status: integration.selectedOrganizationId
          ? ZOHO_INTEGRATION_STATUS.CONNECTED
          : ZOHO_INTEGRATION_STATUS.PENDING_ORGANIZATION_SELECTION,
      },
    }),
  );

  return {
    accessToken: newAccessToken,
    apiDomain: updatedApiDomain,
  };
}
