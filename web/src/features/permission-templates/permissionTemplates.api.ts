import { apiClient } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import type { PageParams, Paginated } from '../../lib/pagination';

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
  /** Resolved server-side to this ORGANIZATION's name for the person — "System"
   * for the seeded profiles (created during signup, before there is an acting
   * user), "Support" for an actor who is not a member here. */
  createdByName: string;
  updatedByName: string;
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

  /**
   * The Settings → Permissions list — the same `{ results, pageContext }` contract
   * as vendors/items/users (see lib/pagination.ts). No `total`: counting is opt-in
   * via `count` below, behind the "Total count: view" link.
   */
  list: async (orgId: string, params: PageParams = {}): Promise<Paginated<PermissionTemplate>> => {
    // The client interceptor unwraps the envelope, so `data` is already the inner
    // `{ results, pageContext }`. Empty params are dropped by axios.
    const { data } = await apiClient.get<Paginated<PermissionTemplate>>(
      endpoints.permissionTemplates.forOrg(orgId),
      { params },
    );
    return data;
  },

  /**
   * Every profile, flat — for the pickers that must offer all of them at once
   * (assigning a user, sending an invitation). A dropdown cannot page, so this
   * asks for the largest page the server allows rather than pretending to.
   *
   * Use `list` for anything that renders a table; this is only for <select>s.
   */
  listAll: async (orgId: string): Promise<PermissionTemplate[]> => {
    const { data } = await apiClient.get<Paginated<PermissionTemplate>>(
      endpoints.permissionTemplates.forOrg(orgId),
      { params: { perPage: 500 } },
    );
    return data.results;
  },

  /** Total matching profiles — only called when the user clicks "view". */
  count: async (orgId: string, params: PageParams = {}): Promise<number> => {
    const { data } = await apiClient.get<{ total: number }>(
      endpoints.permissionTemplates.count(orgId),
      { params },
    );
    return data.total;
  },

  /** One profile, for the detail pane and the edit form. */
  get: async (orgId: string, id: string): Promise<PermissionTemplate> => {
    const { data } = await apiClient.get<PermissionTemplate>(
      endpoints.permissionTemplates.byId(orgId, id),
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
