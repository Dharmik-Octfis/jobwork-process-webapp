import { apiClient } from '../../api/client';
import { endpoints } from '../../api/endpoints';

/** One resource's four actions, as the backend catalog defines them. */
export interface PermissionGroup {
  resource: string;
  label: string;
  actions: { key: string; label: string }[];
}

/** A role (permission template). Permissions are always edited as a whole set —
 * there is no per-user permission, so changing access means a different role. */
export interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isOwner: boolean;
  permissions: string[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoleInput {
  name: string;
  description?: string;
  permissions: string[];
}

export const rolesApi = {
  /** GET …/permission-templates/catalog — the checkbox grid's source of truth. */
  catalog: async (orgId: string): Promise<PermissionGroup[]> => {
    const { data } = await apiClient.get<{ groups: PermissionGroup[] }>(
      endpoints.permissionTemplates.catalog(orgId),
    );
    return data.groups;
  },

  list: async (orgId: string): Promise<Role[]> => {
    const { data } = await apiClient.get<Role[]>(endpoints.permissionTemplates.forOrg(orgId));
    return data;
  },

  create: async (orgId: string, body: RoleInput): Promise<Role> => {
    const { data } = await apiClient.post<Role>(endpoints.permissionTemplates.forOrg(orgId), body);
    return data;
  },

  update: async (orgId: string, id: string, body: Partial<RoleInput>): Promise<Role> => {
    const { data } = await apiClient.put<Role>(endpoints.permissionTemplates.byId(orgId, id), body);
    return data;
  },

  remove: async (orgId: string, id: string): Promise<void> => {
    await apiClient.delete(endpoints.permissionTemplates.byId(orgId, id));
  },
};
