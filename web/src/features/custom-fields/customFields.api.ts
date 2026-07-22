import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import type { CustomFieldConfig, CustomFieldDefinition, DataType } from './customFields.schemas';

const base = (orgId: string) => `/organizations/${orgId}/custom-fields`;

/** Query keys include BOTH orgId and entityType so switching org/module never
 * serves the previous tenant's field set from cache. */
export const activeFieldsKey = (orgId: string, entityType: string) => [
  'custom-fields',
  'active',
  orgId,
  entityType,
];
export const definitionsKey = (orgId: string, entityType: string) => [
  'custom-fields',
  'definitions',
  orgId,
  entityType,
];

export interface CreateFieldPayload {
  entityType: string;
  label: string;
  dataType: DataType;
  config?: CustomFieldConfig;
  isRequired?: boolean;
  showInPrint?: boolean;
  showInList?: boolean;
}

export interface UpdateFieldPayload {
  label?: string;
  config?: CustomFieldConfig;
  isRequired?: boolean;
  showInPrint?: boolean;
  showInList?: boolean;
  status?: 'active' | 'hidden';
}

/** Active fields, for rendering a record form (any member). */
export function useActiveCustomFields(orgId: string | undefined, entityType: string) {
  return useQuery({
    queryKey: activeFieldsKey(orgId ?? '', entityType),
    queryFn: async (): Promise<CustomFieldDefinition[]> => {
      const { data } = await apiClient.get(`${base(orgId!)}?entityType=${entityType}`);
      return data.fields ?? [];
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000, // definitions change rarely; invalidated on admin edits
  });
}

/** All non-archived definitions, for the admin manager (admin only). */
export function useCustomFieldDefinitions(orgId: string | undefined, entityType: string) {
  return useQuery({
    queryKey: definitionsKey(orgId ?? '', entityType),
    queryFn: async (): Promise<CustomFieldDefinition[]> => {
      const { data } = await apiClient.get(`${base(orgId!)}/definitions?entityType=${entityType}`);
      return data.fields ?? [];
    },
    enabled: !!orgId,
  });
}

/** Invalidate both the admin list and the form-render list for a module. */
function invalidateModule(
  queryClient: ReturnType<typeof useQueryClient>,
  orgId: string,
  entityType: string,
): void {
  queryClient.invalidateQueries({ queryKey: definitionsKey(orgId, entityType) });
  queryClient.invalidateQueries({ queryKey: activeFieldsKey(orgId, entityType) });
}

export function useCreateCustomField(orgId: string, entityType: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateFieldPayload): Promise<CustomFieldDefinition> => {
      const { data } = await apiClient.post(`${base(orgId)}/definitions`, payload);
      return data.field;
    },
    onSuccess: () => invalidateModule(queryClient, orgId, entityType),
  });
}

export function useUpdateCustomField(orgId: string, entityType: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data: payload,
    }: {
      id: string;
      data: UpdateFieldPayload;
    }): Promise<CustomFieldDefinition> => {
      const { data } = await apiClient.put(`${base(orgId)}/definitions/${id}`, payload);
      return data.field;
    },
    onSuccess: () => invalidateModule(queryClient, orgId, entityType),
  });
}

export function useReorderCustomFields(orgId: string, entityType: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (items: Array<{ id: string; displayOrder: number }>): Promise<void> => {
      await apiClient.put(`${base(orgId)}/definitions/reorder`, { items });
    },
    onSuccess: () => invalidateModule(queryClient, orgId, entityType),
  });
}

export function useArchiveCustomField(orgId: string, entityType: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.post(`${base(orgId)}/definitions/${id}/archive`);
    },
    onSuccess: () => invalidateModule(queryClient, orgId, entityType),
  });
}
