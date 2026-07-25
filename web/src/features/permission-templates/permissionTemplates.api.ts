import { apiClient } from '../../api/client';
import { endpoints } from '../../api/endpoints';

/** One leaf module and its four actions, as the backend catalog defines them. */
export interface PermissionModule {
  resource: string;
  label: string;
  actions: { key: string; label: string }[];
}

/** A main module from the home-screen sidebar; its modules hang beneath it. The
 * group itself holds no permissions — its checkboxes bulk-toggle the children. */
export interface PermissionGroup {
  key: string;
  label: string;
  modules: PermissionModule[];
}

/**
 * A permission template — a named bundle of permissions, and the ONLY thing that
 * decides what a member may do. It is separate from a role (a job title, see
 * `features/roles/`): the same template can be held by people with different
 * titles, and the same title by people on different templates.
 *
 * Permissions are always edited as a whole set — there is no per-user permission,
 * so varying one person's access means putting them on a different template.
 */
export interface PermissionTemplate {
  id: string;
  name: string;
  description: string | null;
  /** The seeded Owner template: immutable, and never assignable to a member. The
   * other seeds ("Full access", "View only") are ordinary editable rows. */
  isSystem: boolean;
  /** Resolves to the whole catalog at runtime, so future permissions apply with no
   * backfill. Only the Owner template has it; not settable through the API. */
  grantsAllPermissions: boolean;
  permissions: string[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionTemplateInput {
  name: string;
  description?: string;
  permissions: string[];
}

export const permissionTemplatesApi = {
  /** GET …/permission-templates/catalog — the checkbox grid's source of truth. */
  catalog: async (orgId: string): Promise<PermissionGroup[]> => {
    const { data } = await apiClient.get<{ groups: PermissionGroup[] }>(
      endpoints.permissionTemplates.catalog(orgId),
    );
    return data.groups;
  },

  list: async (orgId: string): Promise<PermissionTemplate[]> => {
    const { data } = await apiClient.get<PermissionTemplate[]>(
      endpoints.permissionTemplates.forOrg(orgId),
    );
    return data;
  },

  create: async (orgId: string, body: PermissionTemplateInput): Promise<PermissionTemplate> => {
    const { data } = await apiClient.post<PermissionTemplate>(
      endpoints.permissionTemplates.forOrg(orgId),
      body,
    );
    return data;
  },

  update: async (
    orgId: string,
    id: string,
    body: Partial<PermissionTemplateInput>,
  ): Promise<PermissionTemplate> => {
    const { data } = await apiClient.put<PermissionTemplate>(
      endpoints.permissionTemplates.byId(orgId, id),
      body,
    );
    return data;
  },

  remove: async (orgId: string, id: string): Promise<void> => {
    await apiClient.delete(endpoints.permissionTemplates.byId(orgId, id));
  },
};
