/**
 * The Users screen (Settings → Users) shows ONE list containing two kinds of row:
 * people who have joined, and people who have been invited but haven't. They live
 * in different tables (`memberships`, `invitations`) and only one of them has a
 * membership id, so they are modelled as a discriminated union on `kind` rather
 * than forced into one optional-heavy shape.
 *
 * `status` is what the screen's filter tabs bind to:
 *   active      — joined, and allowed in (`isDeleted: false, isActive: true`)
 *   inactive    — joined, but deactivated in this org; `tenantContext` refuses them
 *   unconfirmed — a pending or declined invitation; no membership row exists yet
 */
export type OrgUserStatus = 'active' | 'inactive' | 'unconfirmed';

/** The person's address — on the ACCOUNT, so shared by every organization they
 * belong to. Every part optional; nobody is forced to fill it in. */
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

/**
 * A joined member, as the Users list and detail pane show them. It is a JOIN of two
 * rows, and which half a field comes from decides who a change affects:
 *
 *   PER-ORGANIZATION (`memberships`) — firstName, lastName, fullName, status,
 *     role, permission template, customFields. Changing these affects this org only.
 *
 *   GLOBAL (`users`) — email, avatarUrl, phone, mobile, dateOfBirth, address.
 *     🔴 Changing these affects EVERY organization the person belongs to. Since
 *     2026-07-31 the account is the single source of truth for personal details; a
 *     person has one date of birth, and per-org copies invite contradictory values.
 */
export interface PublicMember {
  kind: 'member';
  /** The Membership id — what you PUT to. Not the user id. */
  id: string;
  userId: string;
  status: Extract<OrgUserStatus, 'active' | 'inactive'>;
  firstName: string;
  lastName: string;
  fullName: string;
  /** Global, and the one thing a member cannot change per-org. */
  email: string;
  avatarUrl: string | null;
  phone: string | null;
  mobile: string | null;
  /** `YYYY-MM-DD`. A calendar date, deliberately not an ISO instant — serialising a
   * birthday as a timestamp is how it ends up a day earlier in another timezone. */
  dateOfBirth: string | null;
  address: MemberAddress;
  /** Job title. Null when nobody has given them one — it grants nothing either way. */
  roleId: string | null;
  roleName: string | null;
  /** Where this title sits in the org chart, root first: ["CEO", "Manager"]. */
  rolePath: string[];
  /** The permission template that IS their authorization. Null for a legacy row:
   * such a member can do nothing until a template is assigned. */
  permissionTemplateId: string | null;
  permissionTemplateName: string | null;
  /** True for the organization's owner. Above the permission system entirely. */
  isOwner: boolean;
  /** Who added them to this org, resolved to a name in THIS org — see
   * lib/memberDirectory.ts. "System" for self-signup, "Support" for an actor who
   * is not a member here. */
  addedByName: string;
  /** Per-org dynamic fields, keyed by definition key. Surfaced in the list as
   * `cf:<key>` columns, ordered by each definition's `display_order`. */
  customFields: Record<string, unknown>;
  joinedAt: string;
  updatedAt: string;
}

/** A pending/declined invitation, rendered in the same list as a member. */
export interface PublicOrgInvite {
  kind: 'invite';
  /** The Invitation id. Revoke and re-send address this; there is no membership yet. */
  id: string;
  status: Extract<OrgUserStatus, 'unconfirmed'>;
  /** Null only for invitations created before names were required — see the
   * `invitations.first_name` comment in the schema. */
  firstName: string | null;
  lastName: string | null;
  /** Falls back to the email when the invite carries no name. */
  fullName: string;
  email: string;
  roleId: string | null;
  roleName: string | null;
  rolePath: string[];
  permissionTemplateId: string;
  permissionTemplateName: string;
  /** 'pending' | 'declined' — a declined invite stays listed so the admin learns
   * they said no, rather than watching it expire a week later. */
  inviteStatus: string;
  addedByName: string;
  expiresAt: string;
  createdAt: string;
}

export type PublicOrgUser = PublicMember | PublicOrgInvite;

/**
 * The list payload. Counts are for ALL three tabs regardless of which one is being
 * viewed — the tabs show them, so filtering them would make each tab report only
 * itself and every other tab zero.
 */
export interface OrgUserListResult {
  results: PublicOrgUser[];
  counts: Record<OrgUserStatus, number>;
}
