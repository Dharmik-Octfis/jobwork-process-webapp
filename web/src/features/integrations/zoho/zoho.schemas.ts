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

export interface ZohoField {
  field_id?: string;
  field_name: string;
  label: string;
  data_type: string;
  is_mandatory: boolean;
  is_custom_field?: boolean;
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

export interface ZohoEntityFieldsResponse {
  zohoFields: ZohoField[];
  appFields: AppFieldDefinition[];
  defaultMappings: ZohoFieldMappingItem[];
}

export type ZohoSyncMode = 'incremental' | 'full';

export interface ZohoSyncOptions {
  fullSync?: boolean;
  syncMode?: ZohoSyncMode;
  syncAddresses?: boolean;
  syncContactPersons?: boolean;
}

export interface InstantZohoSyncInput {
  module?: ZohoSyncModuleKey | 'all';
  fullSync?: boolean;
  syncMode?: ZohoSyncMode;
  syncAddresses?: boolean;
  syncContactPersons?: boolean;
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

export const saveZohoSyncConfigSchema = z.object({
  module: z.enum(['item', 'customer', 'vendor']),
  syncDirection: z.enum(['TWO_WAY', 'APP_TO_ZOHO', 'ZOHO_TO_APP']).default('TWO_WAY'),
  duplicationPreference: z.string().trim().min(1, 'Duplication preference is required'),
  conflictResolution: z.string().trim().min(1, 'Conflict resolution is required'),
  fieldMappings: z.array(
    z.object({
      id: z.string().optional(),
      zohoField: z.string().trim().min(1),
      zohoFieldLabel: z.string().trim().min(1),
      appField: z.string().trim().min(1),
      appFieldLabel: z.string().trim().min(1),
      isRequired: z.boolean().optional(),
      isSystem: z.boolean().optional(),
      dataType: z.string().optional(),
    }),
  ).min(1, 'At least one field mapping is required'),
  status: z.enum(['ACTIVE', 'PAUSED', 'INACTIVE', 'NOT_CONFIGURED']).optional(),
  autoSyncInterval: z.string().optional(),
  syncAddresses: z.boolean().optional(),
  syncContactPersons: z.boolean().optional(),
});

export type SaveZohoSyncConfigInput = z.infer<typeof saveZohoSyncConfigSchema>;
