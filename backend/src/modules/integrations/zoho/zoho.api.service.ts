import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { ZOHO_PROVIDER, ZOHO_INTEGRATION_STATUS } from './zoho.constants.ts';
import { getValidAccessToken } from './zoho.token.service.ts';
import type { ZohoOrganization, ZohoOrganizationsApiResponse } from './zoho.types.ts';

/**
 * Call Zoho Books Organizations API to fetch all organizations available to the authorized user.
 */
export async function fetchZohoOrganizations(
  organizationId: string,
): Promise<ZohoOrganization[]> {
  const { accessToken, apiDomain } = await getValidAccessToken(organizationId);

  const orgsUrl = `${apiDomain.replace(/\/+$/, '')}/books/v3/organizations`;

  let response: Response;
  try {
    response = await fetch(orgsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Zoho organizations fetch network error:', {
      provider: ZOHO_PROVIDER,
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new ApiError(502, 'Unable to connect to Zoho Books right now. Please try again later.');
  }

  if (!response.ok) {
    console.error('Zoho organizations fetch returned non-200:', {
      provider: ZOHO_PROVIDER,
      organizationId,
      status: response.status,
    });

    if (response.status === 401) {
      throw new ApiError(
        401,
        'Zoho authorization has expired. Please reconnect your Zoho Books account.',
      );
    }

    throw new ApiError(
      502,
      'Zoho account connected, but organizations could not be loaded. Please retry.',
    );
  }

  const data = (await response.json()) as ZohoOrganizationsApiResponse;

  if (data.code !== 0 && data.code !== undefined) {
    console.error('Zoho organizations API returned error code:', {
      provider: ZOHO_PROVIDER,
      organizationId,
      code: data.code,
      message: data.message,
    });
    throw new ApiError(
      502,
      data.message || 'Zoho account connected, but organizations could not be loaded. Please retry.',
    );
  }

  const rawOrgs = data.organizations || [];
  if (rawOrgs.length === 0) {
    throw new ApiError(404, 'No Zoho Books organizations are available for this account.');
  }

  // Map to safe, clean frontend presentation format
  return rawOrgs.map((org) => ({
    organization_id: String(org.organization_id),
    name: org.name || 'Unnamed Organization',
    is_default_org: Boolean(org.is_default_org),
    currency_code: org.currency_code,
    currency_symbol: org.currency_symbol,
    language_code: org.language_code,
    time_zone: org.time_zone,
    is_org_active: org.is_org_active !== false,
    country: org.country,
  }));
}

/**
 * Validate and save the selected Zoho Books organization for the tenant.
 */
export async function saveSelectedZohoOrganization(
  organizationId: string,
  zohoOrgId: string,
  userId?: string,
): Promise<{
  organizationId: string;
  selectedOrganizationId: string;
  selectedOrganizationName: string;
}> {
  // Validate that the requested orgId is actually part of the user's Zoho account
  const availableOrgs = await fetchZohoOrganizations(organizationId);
  const matchedOrg = availableOrgs.find((o) => o.organization_id === String(zohoOrgId));

  if (!matchedOrg) {
    throw new ApiError(
      400,
      'Selected organization is not valid or does not belong to your connected Zoho account.',
    );
  }

  await runAsTenant(organizationId, (tx) =>
    tx.zohoIntegration.update({
      where: { organizationId },
      data: {
        selectedOrganizationId: matchedOrg.organization_id,
        selectedOrganizationName: matchedOrg.name,
        status: ZOHO_INTEGRATION_STATUS.CONNECTED,
        connectedAt: new Date(),
        updatedBy: userId,
      },
    }),
  );

  return {
    organizationId,
    selectedOrganizationId: matchedOrg.organization_id,
    selectedOrganizationName: matchedOrg.name,
  };
}
