import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import type {
  ZohoOrganization,
  ZohoIntegrationStatus,
  SelectZohoOrgInput,
  ConfigureZohoCredentialsInput,
} from './zoho.schemas';

const ZOHO_STATUS_QUERY_KEY = 'zoho-integration-status';
const ZOHO_ORGS_QUERY_KEY = 'zoho-organizations';

/**
 * Fetch current Zoho Books integration status for the organization.
 */
export function useZohoStatus(orgId: string) {
  return useQuery({
    queryKey: [ZOHO_STATUS_QUERY_KEY, orgId],
    queryFn: async (): Promise<ZohoIntegrationStatus> => {
      const res = await apiClient.get(`/organizations/${orgId}/settings/integrations/zoho/status`);
      return res.data;
    },
    enabled: Boolean(orgId),
    staleTime: 30 * 1000,
  });
}

/**
 * Save / update organization Zoho Client ID and Client Secret.
 */
export function useSaveZohoConfig(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ConfigureZohoCredentialsInput) => {
      const res = await apiClient.post(
        `/organizations/${orgId}/settings/integrations/zoho/configure`,
        data,
      );
      return res.data as ZohoIntegrationStatus;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ZOHO_STATUS_QUERY_KEY, orgId] });
    },
  });
}

/**
 * Fetch available Zoho Books organizations for the authorized tenant.
 */
export function useZohoOrganizations(orgId: string, enabled = true) {
  return useQuery({
    queryKey: [ZOHO_ORGS_QUERY_KEY, orgId],
    queryFn: async (): Promise<ZohoOrganization[]> => {
      const res = await apiClient.get(`/organizations/${orgId}/settings/integrations/zoho/organizations`);
      return res.data;
    },
    enabled: Boolean(orgId) && enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/**
 * Get OAuth Authorization URL to initiate Zoho OAuth flow.
 */
export function useZohoConnect(orgId: string) {
  return useMutation({
    mutationFn: async (params?: { accountsServer?: string; returnTo?: string } | void) => {
      const searchParams = new URLSearchParams();
      if (params?.accountsServer) searchParams.set('accounts_server', params.accountsServer);
      if (params?.returnTo) searchParams.set('return_to', params.returnTo);

      const qs = searchParams.toString() ? `?${searchParams.toString()}` : '';
      const res = await apiClient.get(`/organizations/${orgId}/settings/integrations/zoho/connect${qs}`);
      return res.data as { url: string; state: string };
    },
  });
}

/**
 * Save selected Zoho Books organization for the tenant.
 */
export function useSelectZohoOrganization(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: SelectZohoOrgInput) => {
      const res = await apiClient.post(
        `/organizations/${orgId}/settings/integrations/zoho/organization`,
        data,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ZOHO_STATUS_QUERY_KEY, orgId] });
      queryClient.invalidateQueries({ queryKey: [ZOHO_ORGS_QUERY_KEY, orgId] });
    },
  });
}

/**
 * Disconnect Zoho Books integration.
 */
export function useDisconnectZoho(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(
        `/organizations/${orgId}/settings/integrations/zoho/disconnect`,
        {},
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ZOHO_STATUS_QUERY_KEY, orgId] });
      queryClient.invalidateQueries({ queryKey: [ZOHO_ORGS_QUERY_KEY, orgId] });
    },
  });
}

/**
 * Refresh or verify token connection.
 */
export function useRefreshZoho(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(
        `/organizations/${orgId}/settings/integrations/zoho/refresh`,
        {},
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ZOHO_STATUS_QUERY_KEY, orgId] });
    },
  });
}

export const ZOHO_FIELDS_QUERY_KEY = 'zoho-entity-fields';
export const ZOHO_SYNC_SETTINGS_QUERY_KEY = 'zoho-sync-settings';
export const ZOHO_SYNC_HISTORY_QUERY_KEY = 'zoho-sync-history';

/**
 * Fetch Zoho Books fields and application fields for mapping.
 */
export function useZohoEntityFields(orgId: string, entity: string, enabled = true) {
  return useQuery({
    queryKey: [ZOHO_FIELDS_QUERY_KEY, orgId, entity],
    queryFn: async (): Promise<any> => {
      const res = await apiClient.get(
        `/organizations/${orgId}/settings/integrations/zoho/fields?entity=${encodeURIComponent(entity)}`,
      );
      return res.data;
    },
    enabled: Boolean(orgId) && Boolean(entity) && enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch module synchronization settings and statuses.
 */
export function useZohoSyncSettings(orgId: string, enabled = true) {
  return useQuery({
    queryKey: [ZOHO_SYNC_SETTINGS_QUERY_KEY, orgId],
    queryFn: async (): Promise<any> => {
      const res = await apiClient.get(`/organizations/${orgId}/settings/integrations/zoho/sync`);
      return res.data;
    },
    enabled: Boolean(orgId) && enabled,
    staleTime: 30 * 1000,
  });
}

/**
 * Save module synchronization preferences and field mappings.
 */
export function useSaveZohoSyncConfig(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: any) => {
      const res = await apiClient.post(
        `/organizations/${orgId}/settings/integrations/zoho/sync/configure`,
        data,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ZOHO_SYNC_SETTINGS_QUERY_KEY, orgId] });
      queryClient.invalidateQueries({ queryKey: [ZOHO_SYNC_HISTORY_QUERY_KEY, orgId] });
    },
  });
}

/**
 * Toggle module sync active / paused / inactive status.
 */
export function useToggleZohoSync(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { module: string; active?: boolean; status?: string }) => {
      const res = await apiClient.post(
        `/organizations/${orgId}/settings/integrations/zoho/sync/toggle`,
        data,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ZOHO_SYNC_SETTINGS_QUERY_KEY, orgId] });
    },
  });
}

/**
 * Trigger manual Instant or Full Sync for a specific module or all modules.
 */
export function useInstantZohoSync(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { module: string; fullSync?: boolean; syncMode?: 'incremental' | 'full' }) => {
      const res = await apiClient.post(
        `/organizations/${orgId}/settings/integrations/zoho/sync/instant`,
        data,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ZOHO_SYNC_SETTINGS_QUERY_KEY, orgId] });
      queryClient.invalidateQueries({ queryKey: [ZOHO_SYNC_HISTORY_QUERY_KEY, orgId] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
    },
  });
}

/**
 * Trigger common synchronization for ALL active Zoho modules (supports fullSync/syncMode).
 */
export function useSyncAllZohoModules(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data?: { fullSync?: boolean; syncMode?: 'incremental' | 'full' }) => {
      const res = await apiClient.post(
        `/organizations/${orgId}/settings/integrations/zoho/sync/all`,
        data || {},
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ZOHO_SYNC_SETTINGS_QUERY_KEY, orgId] });
      queryClient.invalidateQueries({ queryKey: [ZOHO_SYNC_HISTORY_QUERY_KEY, orgId] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
    },
  });
}

/**
 * Fetch Sync History logs.
 */
export function useZohoSyncHistory(orgId: string, module?: string, enabled = true) {
  return useQuery({
    queryKey: [ZOHO_SYNC_HISTORY_QUERY_KEY, orgId, module || 'all'],
    queryFn: async (): Promise<any[]> => {
      const qs = module ? `?module=${encodeURIComponent(module)}` : '';
      const res = await apiClient.get(
        `/organizations/${orgId}/settings/integrations/zoho/sync/history${qs}`,
      );
      return res.data;
    },
    enabled: Boolean(orgId) && enabled,
    staleTime: 15 * 1000,
  });
}
