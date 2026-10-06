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

export interface ZohoField {
  field_id?: string;
  field_name: string;
  label: string;
  data_type: string;
  is_mandatory: boolean;
  is_custom_field?: boolean;
  max_length?: number;
  default_value?: any;
  options?: Array<{ label: string; value: string }>;
}

export interface ZohoFieldsApiResponse {
  code: number;
  message: string;
  fields?: ZohoField[];
}

export interface AppFieldDefinition {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'select' | 'object';
  required?: boolean;
  isSystem?: boolean;
  isCustomField?: boolean;
  description?: string;
}

export interface ZohoFieldMappingItem {
  id: string;
  zohoField: string;
  zohoFieldLabel: string;
  appField: string;
  appFieldLabel: string;
  isRequired?: boolean;
  isSystem?: boolean;
  dataType?: string;
}

export type ZohoSyncModuleKey = 'item' | 'customer' | 'vendor';
export type ZohoSyncStatus = 'ACTIVE' | 'PAUSED' | 'INACTIVE' | 'NOT_CONFIGURED';
export type ZohoSyncDirection = 'TWO_WAY' | 'APP_TO_ZOHO' | 'ZOHO_TO_APP';
export type ZohoSyncMode = 'incremental' | 'full';

export interface ZohoSyncOptions {
  fullSync?: boolean;
  syncMode?: ZohoSyncMode;
  syncAddresses?: boolean;
  syncContactPersons?: boolean;
}

export interface ZohoModuleSyncConfig {
  module: ZohoSyncModuleKey;
  moduleLabel: string;
  status: ZohoSyncStatus;
  syncDirection: ZohoSyncDirection;
  duplicationPreference: string;
  conflictResolution: string;
  fieldMappings: ZohoFieldMappingItem[];
  lastSyncAt: string | null;
  lastPushAt: string | null;
  autoSyncInterval: string;
  syncAddresses?: boolean;
  syncContactPersons?: boolean;
  stats?: {
    totalSynced?: number;
    lastSyncedCount?: number;
    failedCount?: number;
    lastError?: string | null;
  };
}

export interface ZohoSyncSettings {
  modules: Record<ZohoSyncModuleKey, ZohoModuleSyncConfig>;
}

export interface ZohoSyncLog {
  id: string;
  module: ZohoSyncModuleKey;
  syncType: 'INSTANT' | 'AUTO' | 'SCHEDULED' | 'FULL_SYNC' | 'INCREMENTAL';
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL' | 'IN_PROGRESS';
  syncedCount: number;
  failedCount: number;
  details?: string;
  createdAt: string;
}
