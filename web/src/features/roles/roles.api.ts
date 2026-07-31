import { apiClient } from '../../api/client';
import { endpoints } from '../../api/endpoints';

/**
 * A role is a job title — "Warehouse Supervisor", "Accountant". It carries NO
 * permissions: it says what someone is here to do, not what they may do. Access
 * lives in a permission template (`features/permission-templates/`), assigned
 * separately, so two people with the same title can have different access and one
 * access bundle can span titles.
 */
export interface Role {
  id: string;
  name: string;
  description: string | null;
  /** The built-in root role (seeded as "CEO") — not editable, deletable, or
   * assignable. Test this flag, never the name: an org may rename it. */
  isSystem: boolean;
  /**
   * Who this title reports to; null for a root of the org chart.
   *
   * 🔴 Structure, not access. A parent role grants its children nothing. Never
   * branch on the hierarchy to decide what a user may do or see — that comes only
   * from their permission template.
   */
  parentRoleId: string | null;
  parentRoleName: string | null;
  /** 0 for a root, 1 for its children… Indent by this; the list already arrives as
   * a depth-first walk, so parents are immediately followed by their children. */
  depth: number;
  /** Root-first names including this role: `["CEO", "Senior Manager", "Manager"]`. */
  path: string[];
  /** Members holding THIS title only, never the subtree. */
  memberCount: number;
  /** Direct children. Non-zero blocks deletion. */
  childCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoleInput {
  name: string;
  description?: string;
  /** null (or absent) makes it a root of the org chart. The server refuses cycles,
   * a parent from another org, and trees deeper than 10. */
  parentRoleId?: string | null;
}

export const rolesApi = {
  list: async (orgId: string): Promise<Role[]> => {
    const { data } = await apiClient.get<Role[]>(endpoints.roles.forOrg(orgId));
    return data;
  },

  create: async (orgId: string, body: RoleInput): Promise<Role> => {
    const { data } = await apiClient.post<Role>(endpoints.roles.forOrg(orgId), body);
    return data;
  },

  update: async (orgId: string, id: string, body: Partial<RoleInput>): Promise<Role> => {
    const { data } = await apiClient.put<Role>(endpoints.roles.byId(orgId, id), body);
    return data;
  },

  remove: async (orgId: string, id: string): Promise<void> => {
    await apiClient.delete(endpoints.roles.byId(orgId, id));
  },
};
