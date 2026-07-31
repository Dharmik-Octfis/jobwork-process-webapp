import { apiClient } from '../../api/client';
import { endpoints } from '../../api/endpoints';

/**
 * Settings → Users.
 *
 * 🔴 A `Member` is a JOIN of two rows, and which half a field comes from decides who
 * a change affects:
 *
 *   PER-ORGANIZATION — firstName, lastName, fullName, status, role, permission
 *     template, customFields. The same email can be "Priya Shah" in one org and
 *     "P. Shah" in another; changing one never changes the other.
 *
 *   GLOBAL (the account) — email, avatarUrl, phone, mobile, dateOfBirth, address.
 *     Changing these changes what EVERY organization that person belongs to sees.
 *     The detail pane groups them under a heading that says so, because an admin
 *     editing a phone number has no other way to know the blast radius.
 *
 * The list mixes two kinds of row — people who have joined and people who have only
 * been invited — discriminated on `kind`, because an invite has no membership id and
 * no profile to show.
 */

export type OrgUserStatus = 'active' | 'inactive' | 'unconfirmed';

export interface MemberAddress {
  line1: string | null;
  line2: string | null;
  cityId: string | null;
  cityName: string | null;
  stateCode: string | null;
  stateName: string | null;
  countryCode: string | null;
  countryName: string | null;
  zip: string | null;
}

export interface Member {
  kind: 'member';
  /** The MEMBERSHIP id — what you PUT to. Not the user id. */
  id: string;
  userId: string;
  status: 'active' | 'inactive';
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  phone: string | null;
  mobile: string | null;
  /** `YYYY-MM-DD`, never an ISO instant — a birthday must not shift by timezone. */
  dateOfBirth: string | null;
  address: MemberAddress;
  roleId: string | null;
  roleName: string | null;
  /** Root-first org-chart path: `["CEO", "Senior Manager", "Manager"]`. */
  rolePath: string[];
  permissionTemplateId: string | null;
  permissionTemplateName: string | null;
  isOwner: boolean;
  /** Resolved to a name in THIS org. "System" for self-signup, "Support" for an
   * actor who is not a member here. */
  addedByName: string;
  /** Per-org dynamic fields. Rendered as `cf:<key>` columns in the list, positioned
   * by the display_order an admin sets by dragging in Settings → Modules → Users. */
  customFields: Record<string, unknown>;
  joinedAt: string;
  updatedAt: string;
}

export interface OrgInvite {
  kind: 'invite';
  /** The INVITATION id. There is no membership yet. */
  id: string;
  status: 'unconfirmed';
  firstName: string | null;
  lastName: string | null;
  /** Falls back to the email for invitations created before names were required. */
  fullName: string;
  email: string;
  roleId: string | null;
  roleName: string | null;
  rolePath: string[];
  permissionTemplateId: string;
  permissionTemplateName: string;
  /** 'pending' | 'declined'. */
  inviteStatus: string;
  addedByName: string;
  expiresAt: string;
  createdAt: string;
}

export type OrgUser = Member | OrgInvite;

/** Same `{ results, pageContext }` contract as vendors/items — see lib/pagination.ts.
 * No `total`: counting is a separate, opt-in request behind the "view" link. */
export interface OrgUserPage {
  results: OrgUser[];
  pageContext: { page: number; perPage: number; hasMore: boolean };
}

/**
 * Which rows the list returns. Keys come from the server's filter catalog
 * (`listFilters.catalog.ts`, entity `member`), and the FIRST one is the default —
 * so opening Settings → Users lands on Active Users without the client choosing.
 *
 *   all          Active Users   (default)
 *   inactive     Inactive Users
 *   all_users    All Users
 *   unconfirmed  Unconfirmed Users — invitations, not memberships
 */
export interface ListUsersParams {
  search?: string;
  filter?: string;
  page?: number;
  perPage?: number;
}

/** Narrowing helper so components don't repeat the discriminant check. */
export function isMember(user: OrgUser): user is Member {
  return user.kind === 'member';
}

/**
 * The editable profile fields, used by both the admin and self-service forms.
 *
 * 🔴 Mixed scope, and the split is not obvious from the field names:
 * `firstName`/`lastName` write to the membership (this org only); everything else
 * writes to the account and changes what every organization the person belongs to
 * sees. The detail pane groups them under separate headings for exactly this reason.
 */
export interface MemberProfileBody {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  mobile?: string | null;
  dateOfBirth?: string | null;
  avatarUrl?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  cityId?: string | null;
  stateCode?: string | null;
  countryCode?: string | null;
  zip?: string | null;
}

/**
 * Admin edit of someone else. `roleId: null` clears the job title.
 *
 * `isActive: false` is not cosmetic — the server checks it on every request, so the
 * person loses access to this organization immediately, on every device.
 */
export interface UpdateMemberBody extends MemberProfileBody {
  roleId?: string | null;
  permissionTemplateId?: string;
  isActive?: boolean;
}

export const membersApi = {
  list: async (orgId: string, params: ListUsersParams = {}): Promise<OrgUserPage> => {
    // The client interceptor unwraps the envelope, so `data` is already the inner
    // `{ results, pageContext }`. Empty params are dropped by axios.
    const { data } = await apiClient.get<OrgUserPage>(endpoints.members.forOrg(orgId), { params });
    return data;
  },

  /** Total matching users — only called when the user clicks "view". */
  count: async (orgId: string, params: ListUsersParams = {}): Promise<number> => {
    const { data } = await apiClient.get<{ total: number }>(endpoints.members.count(orgId), {
      params,
    });
    return data.total;
  },

  get: async (orgId: string, membershipId: string): Promise<Member> => {
    const { data } = await apiClient.get<Member>(endpoints.members.byId(orgId, membershipId));
    return data;
  },

  /** Change someone's details, job title, permission template, active state, or any
   * combination. Per-user permission tweaks remain impossible by design — you swap
   * the template. */
  update: async (orgId: string, membershipId: string, body: UpdateMemberBody): Promise<Member> => {
    const { data } = await apiClient.put<Member>(endpoints.members.byId(orgId, membershipId), body);
    return data;
  },

  remove: async (orgId: string, membershipId: string): Promise<void> => {
    await apiClient.delete(endpoints.members.byId(orgId, membershipId));
  },

  /** Your own record in THIS organization. */
  getMe: async (orgId: string): Promise<Member> => {
    const { data } = await apiClient.get<Member>(endpoints.members.me(orgId));
    return data;
  },

  /**
   * Edit your own name and contact details in THIS organization. Deliberately
   * cannot send role, permissions or active state — see `endpoints.members.me`.
   */
  updateMe: async (orgId: string, body: MemberProfileBody): Promise<Member> => {
    const { data } = await apiClient.put<Member>(endpoints.members.me(orgId), body);
    return data;
  },
};
