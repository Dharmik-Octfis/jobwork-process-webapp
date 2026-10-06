import { z } from 'zod';

export const selectZohoOrganizationSchema = z.object({
  organization_id: z.string().trim().min(1, 'Zoho Organization ID is required'),
});

export type SelectZohoOrganizationInput = z.infer<typeof selectZohoOrganizationSchema>;

export const configureZohoCredentialsSchema = z.object({
  client_id: z.string().trim().min(1, 'Zoho Client ID is required').max(255),
  client_secret: z.string().trim().min(1, 'Zoho Client Secret is required').optional(),
  data_center: z.string().trim().toUpperCase().optional(),
  accounts_server: z.string().trim().url().optional(),
});

export type ConfigureZohoCredentialsInput = z.infer<typeof configureZohoCredentialsSchema>;

export const zohoConnectQuerySchema = z.object({
  accounts_server: z.string().url().optional(),
  return_to: z.string().optional(),
});

export type ZohoConnectQueryInput = z.infer<typeof zohoConnectQuerySchema>;

export const zohoFieldMappingItemSchema = z.object({
  id: z.string().optional(),
  zohoField: z.string().trim().min(1, 'Zoho field identifier is required'),
  zohoFieldLabel: z.string().trim().min(1, 'Zoho field label is required'),
  appField: z.string().trim().min(1, 'App field identifier is required'),
  appFieldLabel: z.string().trim().min(1, 'App field label is required'),
  isRequired: z.boolean().optional(),
  isSystem: z.boolean().optional(),
  dataType: z.string().optional(),
});

export const saveZohoSyncConfigSchema = z.object({
  module: z.enum(['item', 'customer', 'vendor']),
  syncDirection: z.enum(['TWO_WAY', 'APP_TO_ZOHO', 'ZOHO_TO_APP']).default('TWO_WAY'),
  duplicationPreference: z.string().trim().min(1, 'Duplication preference is required'),
  conflictResolution: z.string().trim().min(1, 'Conflict resolution is required'),
  fieldMappings: z.array(zohoFieldMappingItemSchema).min(1, 'At least one field mapping is required'),
  status: z.enum(['ACTIVE', 'PAUSED', 'INACTIVE', 'NOT_CONFIGURED']).optional(),
  autoSyncInterval: z.string().optional(),
  syncAddresses: z.boolean().optional(),
  syncContactPersons: z.boolean().optional(),
});

export type SaveZohoSyncConfigInput = z.infer<typeof saveZohoSyncConfigSchema>;

export const toggleZohoSyncSchema = z.object({
  module: z.enum(['item', 'customer', 'vendor']),
  active: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'INACTIVE']).optional(),
});

export type ToggleZohoSyncInput = z.infer<typeof toggleZohoSyncSchema>;

export const instantZohoSyncSchema = z.object({
  module: z.enum(['item', 'customer', 'vendor', 'all']).optional().default('all'),
  fullSync: z.boolean().optional().default(false),
  syncMode: z.enum(['incremental', 'full']).optional(),
  syncAddresses: z.boolean().optional(),
  syncContactPersons: z.boolean().optional(),
});

export type InstantZohoSyncInput = z.infer<typeof instantZohoSyncSchema>;

