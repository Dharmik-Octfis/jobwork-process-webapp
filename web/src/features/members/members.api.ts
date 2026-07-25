import { apiClient } from '../../api/client';
import { endpoints } from '../../api/endpoints';

/**
 * A member of the organization. `id` is the MEMBERSHIP id — that's what you PUT
 * to when changing what they're called or what they can do.
 *
 * The two are independent: `roleId` is a job title and grants nothing;
 * `permissionTemplateId` is the access. Same role + different template, or the
 * same template across roles, are both normal.
 */
export interface Member {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  roleId: string | null;
  roleName: string | null;
  permissionTemplateId: string | null;
  permissionTemplateName: string | null;
  /** The owner's role and permissions can't be changed, and they can't be removed. */
  isOwner: boolean;
  joinedAt: string;
}

/** Send whichever changed. `roleId: null` clears the job title. */
export interface UpdateMemberBody {
  roleId?: string | null;
  permissionTemplateId?: string;
}

export const membersApi = {
  list: async (orgId: string): Promise<Member[]> => {
    const { data } = await apiClient.get<Member[]>(endpoints.members.forOrg(orgId));
    return data;
  },

  /** Change a member's role, their permission template, or both. There are still
   * no per-user permission tweaks by design — you swap the template. */
  update: async (orgId: string, membershipId: string, body: UpdateMemberBody): Promise<Member> => {
    const { data } = await apiClient.put<Member>(endpoints.members.byId(orgId, membershipId), body);
    return data;
  },

  remove: async (orgId: string, membershipId: string): Promise<void> => {
    await apiClient.delete(endpoints.members.byId(orgId, membershipId));
  },
};
