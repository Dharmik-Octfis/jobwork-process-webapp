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
