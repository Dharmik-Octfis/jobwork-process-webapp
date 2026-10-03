import { z } from 'zod';

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

export type ZohoStatusType =
  | 'NOT_CONNECTED'
  | 'CONFIGURED'
  | 'AUTHORIZING'
  | 'PENDING_ORGANIZATION_SELECTION'
  | 'AUTHORIZED'
  | 'CONNECTED'
  | 'TOKEN_EXPIRED'
  | 'ERROR'
  | 'DISCONNECTED';

export interface ZohoIntegrationStatus {
  isConnected: boolean;
  isAuthorized: boolean;
  isConfigured: boolean;
  status: ZohoStatusType;
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

export const selectZohoOrgSchema = z.object({
  organization_id: z.string().min(1, 'Please select an organization'),
});

export type SelectZohoOrgInput = z.infer<typeof selectZohoOrgSchema>;

export const configureZohoCredentialsSchema = z.object({
  client_id: z.string().trim().min(1, 'Zoho Client ID is required'),
  client_secret: z.string().trim().min(1, 'Zoho Client Secret is required').optional(),
  data_center: z.string().trim().toUpperCase().optional(),
  accounts_server: z.string().trim().url().optional(),
});

export type ConfigureZohoCredentialsInput = z.infer<typeof configureZohoCredentialsSchema>;
