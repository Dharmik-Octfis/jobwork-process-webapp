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
  /** The seeded "Owner" role — not editable, deletable, or assignable. */
  isSystem: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoleInput {
  name: string;
  description?: string;
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
