import type { ZohoIntegrationStatus } from './zoho.constants.ts';

export interface ZohoTokenResponse {
  access_token: string;
  refresh_token?: string;
  api_domain?: string;
  token_type?: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

export interface ZohoOrganization {
  organization_id: string;
  name: string;
  is_default_org?: boolean;
  currency_code?: string;
  currency_symbol?: string;
  language_code?: string;
  time_zone?: string;
  is_org_active?: boolean;
  country?: string;
}

export interface ZohoOrganizationsApiResponse {
  code: number;
  message: string;
  organizations?: ZohoOrganization[];
}

export interface ZohoIntegrationSafeStatus {
  isConnected: boolean;
  isAuthorized: boolean;
  isConfigured: boolean;
  status: ZohoIntegrationStatus;
  clientId: string | null;
  hasClientSecret: boolean;
  maskedClientSecret: string | null;
  connectedAt: string | null;
  selectedOrganizationId: string | null;
  selectedOrganizationName: string | null;
  apiDomain: string | null;
  zohoLocation: string | null;
  accountsServer: string | null;
}

export interface ZohoConnectUrlResult {
  url: string;
  state: string;
}
