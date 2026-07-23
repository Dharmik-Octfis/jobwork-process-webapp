import { apiClient } from '../../api/client';
import { endpoints } from '../../api/endpoints';

/** A member of the organization. `id` is the MEMBERSHIP id — that's what you PUT
 * to when changing someone's role. */
export interface Member {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  permissionTemplateId: string | null;
  roleName: string | null;
  /** The owner's role can't be changed and they can't be removed. */
  isOwner: boolean;
  joinedAt: string;
}

export const membersApi = {
  list: async (orgId: string): Promise<Member[]> => {
    const { data } = await apiClient.get<Member[]>(endpoints.members.forOrg(orgId));
    return data;
  },

  /** Assign a different role. There are no per-user permission tweaks by design. */
  assignRole: async (
    orgId: string,
    membershipId: string,
    permissionTemplateId: string,
  ): Promise<Member> => {
    const { data } = await apiClient.put<Member>(endpoints.members.byId(orgId, membershipId), {
      permissionTemplateId,
    });
    return data;
  },

  remove: async (orgId: string, membershipId: string): Promise<void> => {
    await apiClient.delete(endpoints.members.byId(orgId, membershipId));
  },
};
