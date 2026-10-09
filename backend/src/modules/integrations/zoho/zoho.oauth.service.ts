import crypto from 'node:crypto';
import { env } from '../../../config/env.ts';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { encryptToken, decryptToken } from '../../../lib/encryption.ts';
import {
  ZOHO_PROVIDER,
  ZOHO_DEFAULT_ACCOUNTS_URL,
  ZOHO_DEFAULT_API_DOMAIN,
  ZOHO_DEFAULT_SCOPE,
  ZOHO_INTEGRATION_STATUS,
  ZOHO_DATA_CENTERS,
} from './zoho.constants.ts';
import type {
  ZohoTokenResponse,
  ZohoIntegrationSafeStatus,
  ZohoConnectUrlResult,
} from './zoho.types.ts';

/**
 * Resolve the appropriate Zoho Accounts Server URL based on parameters and data centers.
 */
export function resolveAccountsServer(
  explicitServer?: string | null,
  location?: string | null,
): string {
  if (explicitServer) {
    let server = explicitServer.trim().replace(/\/+$/, '');
    if (server && !/^https?:\/\//i.test(server)) {
      server = `https://${server}`;
    }
    return server;
  }

  if (location) {
    const locUpper = location.trim().toUpperCase();
    if (ZOHO_DATA_CENTERS[locUpper]) {
      return ZOHO_DATA_CENTERS[locUpper].accountsUrl;
    }
  }

  return (env.zoho.accountsUrl || ZOHO_DEFAULT_ACCOUNTS_URL).replace(/\/+$/, '');
}

/**
 * Save or update organization-specific Zoho OAuth credentials (Client ID and Client Secret).
 * The Client Secret is encrypted with AES-256-GCM before being persisted.
 */
export async function saveZohoCredentials(
  organizationId: string,
  clientId: string,
  clientSecret?: string,
  dataCenter?: string,
  accountsServerOverride?: string,
  userId?: string,
): Promise<ZohoIntegrationSafeStatus> {
  const trimmedClientId = clientId.trim();
  const trimmedClientSecret = clientSecret?.trim();
  const trimmedDataCenter = dataCenter?.trim()?.toUpperCase();
  const resolvedAccounts = resolveAccountsServer(accountsServerOverride, trimmedDataCenter);

  if (!trimmedClientId) {
    throw ApiError.badRequest('Zoho Client ID is required.');
  }

  await runAsTenant(organizationId, async (tx) => {
    const existing = await tx.zohoIntegration.findUnique({
      where: { organizationId },
    });

    const encryptedSecret = trimmedClientSecret
      ? encryptToken(trimmedClientSecret)
      : existing?.clientSecret || (env.zoho.clientSecret ? encryptToken(env.zoho.clientSecret) : null);

    if (!encryptedSecret) {
      throw ApiError.badRequest('Zoho Client Secret is required.');
    }

    if (existing) {
      const newStatus =
        existing.status === ZOHO_INTEGRATION_STATUS.CONNECTED
          ? ZOHO_INTEGRATION_STATUS.CONNECTED
          : ZOHO_INTEGRATION_STATUS.CONFIGURED;

      await tx.zohoIntegration.update({
        where: { organizationId },
        data: {
          clientId: trimmedClientId,
          clientSecret: encryptedSecret,
          zohoLocation: trimmedDataCenter || existing.zohoLocation || 'IN',
          accountsServer: resolvedAccounts,
          status: newStatus,
          isDeleted: false,
          updatedBy: userId,
        },
      });
    } else {
      await tx.zohoIntegration.create({
        data: {
          organizationId,
          provider: ZOHO_PROVIDER,
          clientId: trimmedClientId,
          clientSecret: encryptedSecret,
          zohoLocation: trimmedDataCenter || 'IN',
          accountsServer: resolvedAccounts,
          status: ZOHO_INTEGRATION_STATUS.CONFIGURED,
          isDeleted: false,
          createdBy: userId,
          updatedBy: userId,
        },
      });
    }
  });

  return getSafeIntegrationStatus(organizationId);
}

/**
 * Generate secure OAuth state and construct the Zoho Authorization URL.
 */
export async function buildAuthorizationUrl(
  organizationId: string,
  userId: string,
  accountsServerOverride?: string,
  returnTo?: string,
): Promise<ZohoConnectUrlResult> {
  // 1. Retrieve organization's configured Zoho credentials
  const integration = await runAsTenant(organizationId, (tx) =>
    tx.zohoIntegration.findUnique({
      where: { organizationId },
    }),
  );

  const clientId = integration?.clientId || env.zoho.clientId;
  const clientSecret = integration?.clientSecret || env.zoho.clientSecret;
  const redirectUri = env.zoho.redirectUri;

  if (!clientId || !clientSecret) {
    throw new ApiError(
      400,
      'Zoho Client ID and Client Secret are not configured. Please enter your credentials first.',
    );
  }

  if (!redirectUri) {
    throw new ApiError(
      500,
      'Zoho redirect URI (ZOHO_REDIRECT_URI) is not configured in the application environment.',
    );
  }

  const state = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes TTL

  const accountsServer = resolveAccountsServer(
    accountsServerOverride || integration?.accountsServer,
    integration?.zohoLocation,
  );

  // Clean up any expired oauth_states for this organization
  await prisma.oAuthState
    .deleteMany({
      where: {
        organizationId,
        expiresAt: { lt: new Date() },
      },
    })
    .catch(() => {});

  // Persist the OAuth state associated with this authenticated user and organization
  await prisma.oAuthState.create({
    data: {
      state,
      organizationId,
      userId,
      provider: ZOHO_PROVIDER,
      accountsServer,
      returnTo,
      expiresAt,
      usedAt: null,
    },
  });

  const params = new URLSearchParams({
    scope: env.zoho.scopes || ZOHO_DEFAULT_SCOPE,
    client_id: clientId,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    redirect_uri: redirectUri,
    state,
  });

  const url = `${accountsServer}/oauth/v2/auth?${params.toString()}`;

  return { url, state };
}

/**
 * Handle Zoho OAuth callback: validate state, exchange code for tokens, and persist integration.
 */
export async function handleCallback(
  code: string,
  state: string,
  accountsServerParam?: string,
  locationParam?: string,
): Promise<{ organizationId: string; returnTo?: string }> {
  if (!code) {
    throw new ApiError(400, 'Authorization code is missing in the callback request.');
  }

  if (!state) {
    throw new ApiError(400, 'OAuth state is missing. Unable to verify request.');
  }

  // 1. Validate state from database
  const stateRecord = await prisma.oAuthState.findUnique({
    where: { state },
  });

  if (!stateRecord || stateRecord.expiresAt < new Date() || stateRecord.usedAt !== null) {
    throw new ApiError(
      400,
      'Unable to verify the Zoho authorization request. The session has expired, is invalid, or was already used. Please try again.',
    );
  }

  // 2. Mark state as used
  await prisma.oAuthState
    .update({
      where: { id: stateRecord.id },
      data: { usedAt: new Date() },
    })
    .catch(() => {});

  const organizationId = stateRecord.organizationId;
  const userId = stateRecord.userId;

  // 3. Resolve organization credentials
  const integration = await runAsTenant(organizationId, (tx) =>
    tx.zohoIntegration.findUnique({
      where: { organizationId },
    }),
  );

  const clientId = integration?.clientId || env.zoho.clientId;
  const clientSecret = integration?.clientSecret
    ? decryptToken(integration.clientSecret)
    : env.zoho.clientSecret;

  if (!clientId || !clientSecret || !env.zoho.redirectUri) {
    throw new ApiError(
      500,
      'Zoho integration credentials are not configured for this organization.',
    );
  }

  // 4. Resolve the accounts server
  const accountsServer = resolveAccountsServer(
    accountsServerParam || stateRecord.accountsServer,
    locationParam,
  );

  // 5. Exchange authorization code for tokens
  const tokenUrl = `${accountsServer}/oauth/v2/token`;
  const bodyParams = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: env.zoho.redirectUri,
    code,
  });

  let tokenData: ZohoTokenResponse;
  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: bodyParams.toString(),
    });

    tokenData = (await response.json()) as ZohoTokenResponse;
  } catch (error) {
    console.error('Zoho token exchange network error:', {
      provider: ZOHO_PROVIDER,
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new ApiError(502, 'Unable to connect to Zoho Books right now. Please try again later.');
  }

  if (tokenData.error || !tokenData.access_token) {
    console.error('Zoho token exchange failed:', {
      provider: ZOHO_PROVIDER,
      organizationId,
      error: tokenData.error,
      description: tokenData.error_description,
    });

    if (tokenData.error === 'invalid_code') {
      throw new ApiError(
        400,
        'Zoho authorization code expired or has already been used. Please connect again.',
      );
    }
    if (tokenData.error === 'invalid_client' || tokenData.error === 'invalid_client_secret') {
      throw new ApiError(
        400,
        'Zoho Client ID or Client Secret is invalid. Please verify your configured credentials.',
      );
    }
    if (tokenData.error === 'invalid_redirect_uri') {
      throw new ApiError(
        500,
        'Zoho redirect URI mismatch. Please verify the configured redirect URI.',
      );
    }

    throw new ApiError(
      400,
      tokenData.error_description || 'Unable to complete Zoho authorization. Token exchange failed.',
    );
  }

  // 6. Encrypt tokens at rest
  const encryptedAccessToken = encryptToken(tokenData.access_token);
  const encryptedRefreshToken = tokenData.refresh_token
    ? encryptToken(tokenData.refresh_token)
    : undefined;

  const expiresInSec = tokenData.expires_in || 3600;
  const expiresAt = new Date(Date.now() + (expiresInSec - 60) * 1000); // 60-second buffer
  const apiDomain = tokenData.api_domain || ZOHO_DEFAULT_API_DOMAIN;

  // 7. Persist integration record for this tenant
  await runAsTenant(organizationId, async (tx) => {
    const existing = await tx.zohoIntegration.findUnique({
      where: { organizationId },
    });

    if (existing) {
      await tx.zohoIntegration.update({
        where: { organizationId },
        data: {
          status: ZOHO_INTEGRATION_STATUS.PENDING_ORGANIZATION_SELECTION,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken || existing.refreshToken,
          tokenType: tokenData.token_type || 'Bearer',
          expiresAt,
          apiDomain,
          accountsServer,
          zohoLocation: locationParam || existing.zohoLocation,
          isDeleted: false,
          updatedBy: userId,
        },
      });
    } else {
      await tx.zohoIntegration.create({
        data: {
          organizationId,
          provider: ZOHO_PROVIDER,
          clientId,
          clientSecret: encryptToken(clientSecret),
          status: ZOHO_INTEGRATION_STATUS.PENDING_ORGANIZATION_SELECTION,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken || null,
          tokenType: tokenData.token_type || 'Bearer',
          expiresAt,
          apiDomain,
          accountsServer,
          zohoLocation: locationParam || null,
          isDeleted: false,
          createdBy: userId,
          updatedBy: userId,
        },
      });
    }
  });

  return {
    organizationId,
    returnTo: stateRecord.returnTo || undefined,
  };
}

/**
 * Return safe integration status for frontend consumption without exposing sensitive secrets or raw tokens.
 */
export async function getSafeIntegrationStatus(
  organizationId: string,
): Promise<ZohoIntegrationSafeStatus> {
  const integration = await runAsTenant(organizationId, (tx) =>
    tx.zohoIntegration.findUnique({
      where: { organizationId },
    }),
  );

  const hasClientId = Boolean(integration?.clientId || env.zoho.clientId);
  const hasClientSecret = Boolean(integration?.clientSecret || env.zoho.clientSecret);
  const isConfigured = hasClientId && hasClientSecret;

  if (!integration || integration.isDeleted) {
    return {
      isConnected: false,
      isAuthorized: false,
      isConfigured,
      status: isConfigured
        ? ZOHO_INTEGRATION_STATUS.CONFIGURED
        : ZOHO_INTEGRATION_STATUS.NOT_CONNECTED,
      clientId: integration?.clientId || null,
      hasClientSecret,
      maskedClientSecret: hasClientSecret ? '••••••••••••' : null,
      connectedAt: null,
      selectedOrganizationId: null,
      selectedOrganizationName: null,
      apiDomain: null,
      zohoLocation: null,
      accountsServer: null,
    };
  }

  const isConnected =
    integration.status === ZOHO_INTEGRATION_STATUS.CONNECTED &&
    Boolean(integration.selectedOrganizationId);
  const isAuthorized =
    Boolean(integration.refreshToken) &&
    (integration.status === ZOHO_INTEGRATION_STATUS.AUTHORIZED ||
      integration.status === ZOHO_INTEGRATION_STATUS.PENDING_ORGANIZATION_SELECTION ||
      isConnected);

  return {
    isConnected,
    isAuthorized,
    isConfigured,
    status: integration.status as ZohoIntegrationSafeStatus['status'],
    clientId: integration.clientId || null,
    hasClientSecret,
    maskedClientSecret: hasClientSecret ? '••••••••••••' : null,
    connectedAt: integration.connectedAt ? integration.connectedAt.toISOString() : null,
    selectedOrganizationId: integration.selectedOrganizationId,
    selectedOrganizationName: integration.selectedOrganizationName,
    apiDomain: integration.apiDomain,
    zohoLocation: integration.zohoLocation,
    accountsServer: integration.accountsServer,
  };
}

/**
 * Disconnect Zoho Books integration by clearing tokens and resetting status.
 * Preserves configured Client ID and Client Secret so reconnecting is easy.
 */
export async function disconnectIntegration(
  organizationId: string,
  userId?: string,
): Promise<void> {
  await runAsTenant(organizationId, async (tx) => {
    const integration = await tx.zohoIntegration.findUnique({
      where: { organizationId },
    });

    if (!integration) {
      return;
    }

    // Programmatically revoke the refresh token with Zoho Accounts API so Zoho requires fresh consent
    if (integration.refreshToken) {
      try {
        const decryptedRefreshToken = decryptToken(integration.refreshToken);
        const accountsServer = resolveAccountsServer(
          integration.accountsServer,
          integration.zohoLocation,
        );
        const revokeUrl = `${accountsServer}/oauth/v2/token/revoke`;

        await fetch(revokeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: decryptedRefreshToken }).toString(),
        }).catch(() => {});
      } catch (err) {
        console.warn('Zoho token revocation failed during disconnect:', err);
      }
    }

    await tx.zohoIntegration.update({
      where: { organizationId },
      data: {
        status: ZOHO_INTEGRATION_STATUS.DISCONNECTED,
        refreshToken: null,
        accessToken: null,
        selectedOrganizationId: null,
        selectedOrganizationName: null,
        connectedAt: null,
        updatedBy: userId,
      },
    });
  });
}
