import { runAsTenant, type TenantClient } from '../../../../db/prisma.ts';
import { ApiError } from '../../../../lib/apiError.ts';
import {
  composeFullName,
  getMemberDirectory,
  invalidateMemberDirectory,
} from '../../../../lib/memberDirectory.ts';
import { pageSlice, searchWhere, takeForPage, type ListQuery } from '../../../../lib/pagination.ts';
import { filterWhere } from '../../list-views/listFilters.catalog.ts';
import type { UpdateMemberInput, UpdateMyProfileInput } from './members.schemas.ts';
import type { MemberAddress, PublicMember, PublicOrgInvite } from './members.types.ts';
import type { Prisma } from '../../../../../generated/prisma/client.ts';

/**
 * Settings → Users. A member is a JOIN of two rows, and which half a field lives on
 * decides who a change affects:
 *
 *   `memberships` — display name, active state, job title, permission template, and
 *     this org's custom-field values. Changing these affects THIS organization only.
 *   `users` — email and every personal detail (phone, mobile, date of birth,
 *     address, avatar). Changing these affects EVERY organization the person is in.
 *
 * See the schema comments on both models for why the line sits there.
 *
 * 🔴 Every read here runs inside `runAsTenant` even though `memberships` and
 * `invitations` carry no RLS policy — because `roles` and `permission_templates`
 * DO. A nested `role: { select: … }` issued outside a tenant context comes back
 * `null`, so the screen would silently lose every role and template name rather
 * than fail. The `organizationId` filters are still the real isolation for the two
 * un-gated tables.
 */

/**
 * 🔴 Note where each field comes from — it is the whole data model in one object.
 *
 * On the MEMBERSHIP (per-organization): the display name, active state, job title,
 * permission template, and this org's custom-field values.
 *
 * On the USER (global, shared by every org they belong to): email and every
 * personal detail — phone, mobile, date of birth, address, avatar. Editing those
 * changes what all their organizations see.
 */
const MEMBER_SELECT = {
  id: true,
  userId: true,
  isOwner: true,
  isActive: true,
  firstName: true,
  lastName: true,
  fullName: true,
  roleId: true,
  permissionTemplateId: true,
  customFields: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  user: {
    select: {
      email: true,
      avatarUrl: true,
      phone: true,
      mobile: true,
      dateOfBirth: true,
      addressLine1: true,
      addressLine2: true,
      cityId: true,
      stateCode: true,
      countryCode: true,
      zip: true,
      city: { select: { name: true } },
      state: { select: { name: true } },
      country: { select: { name: true } },
    },
  },
  role: { select: { name: true } },
  permissionTemplate: { select: { name: true } },
} as const;

const INVITE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  roleId: true,
  permissionTemplateId: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  invitedById: true,
  role: { select: { name: true } },
  permissionTemplate: { select: { name: true } },
} as const;

type MemberRow = {
  id: string;
  userId: string;
  isOwner: boolean;
  isActive: boolean;
  firstName: string;
  lastName: string;
  fullName: string;
  roleId: string | null;
  permissionTemplateId: string | null;
  customFields: unknown;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  /** The account. Everything here is shared by every org this person belongs to. */
  user: {
    email: string;
    avatarUrl: string | null;
    phone: string | null;
    mobile: string | null;
    dateOfBirth: Date | null;
    addressLine1: string | null;
    addressLine2: string | null;
    cityId: string | null;
    stateCode: string | null;
    countryCode: string | null;
    zip: string | null;
    city: { name: string } | null;
    state: { name: string } | null;
    country: { name: string } | null;
  };
  role: { name: string } | null;
  permissionTemplate: { name: string } | null;
};

/**
 * A `@db.Date` column carries no time and no zone. Prisma still hands back a
 * `Date`, so serialising it with `toISOString()` and keeping the time part is how a
 * birthday ends up rendering a day early west of UTC. Slice to the date.
 */
function toDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** `YYYY-MM-DD` → the UTC midnight Postgres stores for a `date`. */
function fromDateOnly(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

/** The account's address — shared across every organization this person is in. */
function toAddress(row: MemberRow): MemberAddress {
  return {
    line1: row.user.addressLine1,
    line2: row.user.addressLine2,
    cityId: row.user.cityId,
    cityName: row.user.city?.name ?? null,
    stateCode: row.user.stateCode,
    stateName: row.user.state?.name ?? null,
    countryCode: row.user.countryCode,
    countryName: row.user.country?.name ?? null,
    zip: row.user.zip,
  };
}

// ── Role hierarchy ──────────────────────────────────────────────────────────
//
// The tree is display structure, never access (see the `Role` schema comment).
// Both list and detail render a title as its path from the root — "Owner ›
// Manager › Supervisor" — which is only meaningful with every role in hand, so
// they are loaded once per request and walked in memory.

const MAX_ROLE_DEPTH = 20;

type RoleNode = { name: string; parentRoleId: string | null };

async function loadRoleTree(
  tx: TenantClient,
  organizationId: string,
): Promise<Map<string, RoleNode>> {
  const roles = await tx.role.findMany({
    where: { organizationId, isDeleted: false },
    select: { id: true, name: true, parentRoleId: true },
  });
  return new Map(roles.map((r) => [r.id, { name: r.name, parentRoleId: r.parentRoleId }]));
}

/**
 * Root-first path to a role: `["Owner", "Manager", "Supervisor"]`.
 *
 * Depth-capped and visited-guarded. `createRole`/`updateRole` already refuse to
 * create a cycle, so a cycle here would mean the data was edited outside the app —
 * in which case rendering a truncated path beats hanging the request.
 */
function rolePathFor(roleId: string | null, tree: Map<string, RoleNode>): string[] {
  if (!roleId) return [];
  const path: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = roleId;

  while (cursor && path.length < MAX_ROLE_DEPTH && !seen.has(cursor)) {
    seen.add(cursor);
    const node = tree.get(cursor);
    if (!node) break; // soft-deleted mid-tree; show what we have
    path.unshift(node.name);
    cursor = node.parentRoleId;
  }

  return path;
}

function resolveAvatarUrl(avatarUrl: string | null): string | null {
  if (!avatarUrl) return null;
  if (
    avatarUrl.startsWith('http://') ||
    avatarUrl.startsWith('https://') ||
    avatarUrl.startsWith('data:')
  ) {
    return avatarUrl;
  }
  return `/api/storage/stream?key=${encodeURIComponent(avatarUrl)}`;
}

function toPublicMember(
  row: MemberRow,
  tree: Map<string, RoleNode>,
  addedByName: string,
): PublicMember {
  return {
    kind: 'member',
    id: row.id,
    userId: row.userId,
    status: row.isActive ? 'active' : 'inactive',
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: row.fullName,
    // Everything from here to `address` is the ACCOUNT's, not this org's.
    email: row.user.email,
    avatarUrl: resolveAvatarUrl(row.user.avatarUrl),
    phone: row.user.phone,
    mobile: row.user.mobile,
    dateOfBirth: toDateOnly(row.user.dateOfBirth),
    address: toAddress(row),
    roleId: row.roleId,
    roleName: row.role?.name ?? null,
    rolePath: rolePathFor(row.roleId, tree),
    permissionTemplateId: row.permissionTemplateId,
    permissionTemplateName: row.permissionTemplate?.name ?? null,
    isOwner: row.isOwner,
    addedByName,
    // Per-org dynamic fields, passed through as stored. The list merges them in as
    // `cf:` columns ordered by each definition's display_order.
    customFields: (row.customFields ?? {}) as Record<string, unknown>,
    joinedAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPublicInvite(
  row: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    roleId: string | null;
    permissionTemplateId: string;
    status: string;
    expiresAt: Date;
    createdAt: Date;
    invitedById: string;
    role: { name: string } | null;
    permissionTemplate: { name: string };
  },
  tree: Map<string, RoleNode>,
  addedByName: string,
): PublicOrgInvite {
  // Invitations created before names were required have none. Falling back to the
  // email keeps the row readable instead of rendering a blank line.
  const composed = composeFullName(row.firstName ?? '', row.lastName ?? '');

  return {
    kind: 'invite',
    id: row.id,
    status: 'unconfirmed',
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: composed || row.email,
    email: row.email,
    roleId: row.roleId,
    roleName: row.role?.name ?? null,
    rolePath: rolePathFor(row.roleId, tree),
    permissionTemplateId: row.permissionTemplateId,
    permissionTemplateName: row.permissionTemplate.name,
    inviteStatus: row.status,
    addedByName,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The Users list — the same paginated + searchable contract every other module
 * uses (`lib/pagination.ts`, memory: list-search-pagination-pattern), so the screen
 * can be built from the shared `useListSearch` / `useListColumns` / `Pagination`
 * pieces rather than a bespoke roster.
 *
 * 🔴 ONE FILTER, ONE TABLE. Each preset resolves to exactly one source:
 *
 *   all (Active Users) · inactive · all_users   → `memberships`
 *   unconfirmed                                 → `invitations`
 *
 * That is what keeps pagination honest. A genuine UNION of the two tables cannot be
 * paged with `skip`/`take` — you would have to over-fetch both and slice in memory,
 * and `hasMore` would start lying the moment either side had more rows than the
 * page. Since an admin picks one view at a time anyway, the presets are drawn so
 * the question never arises. See listFilters.catalog.ts.
 */
async function listUnconfirmed(
  organizationId: string,
  opts: ListQuery,
  directory: { actorName(id: string | null | undefined): string },
) {
  const { page, perPage } = opts;

  return runAsTenant(organizationId, async (tx) => {
    const tree = await loadRoleTree(tx, organizationId);

    // Only unaccepted invites are "unconfirmed users": an accepted one already has a
    // membership row and would otherwise appear twice, and a revoked one is gone.
    // `declined` stays so the admin learns they said no rather than watching the
    // invite expire silently a week later.
    const rows = await tx.invitation.findMany({
      where: {
        organizationId,
        status: { in: ['pending', 'declined'] },
        ...searchWhere<Prisma.InvitationWhereInput>(opts.search, [
          'email',
          'firstName',
          'lastName',
        ]),
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
      select: INVITE_SELECT,
    });

    const { results, pageContext } = pageSlice(rows, page, perPage);
    return {
      results: results.map((r) => toPublicInvite(r, tree, directory.actorName(r.invitedById))),
      pageContext,
    };
  });
}

/**
 * The one `where` both the list and the count are built from — so the total can
 * never disagree with the rows on screen because the two queries drifted.
 */
function memberListWhere(organizationId: string, opts: ListQuery): Prisma.MembershipWhereInput {
  return {
    // The `where` is what the query *means*. Unlike the other modules there is no
    // RLS net under this one — `memberships` carries no policy by design — so this
    // organizationId filter is the whole of the tenant isolation here.
    organizationId,
    // Preset view ("Active Users"), spread in so it narrows rather than replaces.
    // Every member preset carries its own `isDeleted: false`, so removed people
    // never surface, search included.
    ...filterWhere<Prisma.MembershipWhereInput>('member', opts.filter),
    // Search spans BOTH tables now, which `searchWhere` cannot express — it builds a
    // flat OR over columns of one model. The per-org name lives on the membership;
    // email, phone and mobile live on the account. Hand-written so both are reachable
    // from one box, since an admin searching "9876" does not know or care which table
    // a phone number is in.
    ...(opts.search
      ? {
          OR: [
            { fullName: { contains: opts.search, mode: 'insensitive' as const } },
            { firstName: { contains: opts.search, mode: 'insensitive' as const } },
            { lastName: { contains: opts.search, mode: 'insensitive' as const } },
            { user: { email: { contains: opts.search, mode: 'insensitive' as const } } },
            { user: { phone: { contains: opts.search, mode: 'insensitive' as const } } },
            { user: { mobile: { contains: opts.search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };
}

export async function listOrgUsers(organizationId: string, opts: ListQuery) {
  // 🔴 Directory FIRST, outside the transaction, in every function in this file.
  // `memberships` carries no RLS policy so it needs no tenant context — and
  // acquiring a second pooled connection while already holding a transaction is how
  // a 5-connection pool deadlocks under concurrency (enough simultaneous requests
  // each holding one and waiting for another and nobody can proceed).
  const directory = await getMemberDirectory(organizationId);

  if (opts.filter === 'unconfirmed') {
    return listUnconfirmed(organizationId, opts, directory);
  }

  const { page, perPage } = opts;

  return runAsTenant(organizationId, async (tx) => {
    const tree = await loadRoleTree(tx, organizationId);

    // No COUNT here — fetch one row beyond the page and let its presence answer
    // "is there a next page?". The total is a separate, opt-in request.
    const rows = await tx.membership.findMany({
      where: memberListWhere(organizationId, opts),
      orderBy: [{ isOwner: 'desc' }, { fullName: 'asc' }], // owner pinned, then A–Z
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
      select: MEMBER_SELECT,
    });

    const { results, pageContext } = pageSlice(rows as MemberRow[], page, perPage);
    return {
      results: results.map((r) => toPublicMember(r, tree, directory.actorName(r.createdBy))),
      pageContext,
    };
  });
}

/** The opt-in total behind the "Total count: view" link. Built from the same
 * `where` as the list, so the number always matches the rows. */
export async function countOrgUsers(organizationId: string, opts: ListQuery): Promise<number> {
  if (opts.filter === 'unconfirmed') {
    return runAsTenant(organizationId, (tx) =>
      tx.invitation.count({
        where: {
          organizationId,
          status: { in: ['pending', 'declined'] },
          ...searchWhere<Prisma.InvitationWhereInput>(opts.search, [
            'email',
            'firstName',
            'lastName',
          ]),
        },
      }),
    );
  }

  return runAsTenant(organizationId, (tx) =>
    tx.membership.count({ where: memberListWhere(organizationId, opts) }),
  );
}

/** One member, for the detail pane. Includes deactivated members — the Inactive
 * tab has to be able to open them. Soft-deleted (removed) members 404. */
export async function getMember(
  organizationId: string,
  membershipId: string,
): Promise<PublicMember> {
  const directory = await getMemberDirectory(organizationId);

  return runAsTenant(organizationId, async (tx) => {
    const row = await tx.membership.findFirst({
      where: { id: membershipId, organizationId, isDeleted: false },
      select: MEMBER_SELECT,
    });
    if (!row) throw ApiError.notFound('User not found.');

    const tree = await loadRoleTree(tx, organizationId);
    return toPublicMember(row as MemberRow, tree, directory.actorName(row.createdBy));
  });
}

/**
 * Prove a permission template may be handed to this member. The Owner template is
 * refused: ownership comes from creating the organization, not from being granted.
 */
async function assertAssignableTemplate(
  tx: TenantClient,
  organizationId: string,
  permissionTemplateId: string,
): Promise<void> {
  const template = await tx.permissionTemplate.findFirst({
    where: { id: permissionTemplateId, organizationId, isDeleted: false },
    select: { isSystem: true },
  });
  if (!template) throw ApiError.badRequest('That permission template does not exist.');
  // `isSystem` is the Owner template. The seeded "Full access" / "View only" rows
  // are ordinary editable templates and freely assignable.
  if (template.isSystem) {
    throw new ApiError(403, 'The Owner permission template cannot be assigned to another member.');
  }
}

/** Prove a job title may be handed to this member. The built-in system role (the
 * seeded "CEO") is refused for the same reason its template is — it means "this
 * is the owner". Matched on `isSystem`, never on the name, so renaming it in the
 * catalog or in an org changes nothing here. */
async function assertAssignableRole(
  tx: TenantClient,
  organizationId: string,
  roleId: string,
): Promise<void> {
  const role = await tx.role.findFirst({
    where: { id: roleId, organizationId, isDeleted: false },
    select: { isSystem: true, name: true },
  });
  if (!role) throw ApiError.badRequest('That role does not exist.');
  if (role.isSystem) {
    throw new ApiError(
      403,
      `The built-in "${role.name}" role cannot be assigned to another member.`,
    );
  }
}

/**
 * Turn validated input into the profile columns, and keep `fullName` in step.
 *
 * Only keys the caller actually sent are written — `undefined` means "not
 * mentioned", `null` means "clear it", and the two must not be conflated or every
 * partial update would blank the fields it left out.
 */
function membershipNameData(
  input: UpdateMemberInput | UpdateMyProfileInput,
  existing: { firstName: string; lastName: string },
): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  if (input.firstName !== undefined) data.firstName = input.firstName;
  if (input.lastName !== undefined) data.lastName = input.lastName;

  // `fullName` is derived, so it is rewritten whenever either part moves — using
  // the incoming value where given and the stored one otherwise, so changing only
  // the surname does not lose the forename.
  if (input.firstName !== undefined || input.lastName !== undefined) {
    data.fullName = composeFullName(
      input.firstName ?? existing.firstName,
      input.lastName ?? existing.lastName,
    );
  }

  return data;
}

/**
 * The ACCOUNT half of an update — everything that is not the per-org display name.
 *
 * 🔴 These columns live on `users` and are shared by every organization the person
 * belongs to. Writing them here changes what all of those organizations see. That
 * is the single-source-of-truth trade made on 2026-07-31, not an oversight; the UI
 * labels the section "shared across organizations" so an admin knows the blast
 * radius before they type.
 *
 * Deliberately does NOT touch `users.firstName/lastName/fullName`. The account name
 * is its own thing — used by invitation emails, password resets and the org picker
 * — and renaming someone inside an organization must never rewrite it.
 */
function accountDetailData(
  input: UpdateMemberInput | UpdateMyProfileInput,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  if (input.phone !== undefined) data.phone = input.phone;
  if (input.mobile !== undefined) data.mobile = input.mobile;
  if (input.dateOfBirth !== undefined) data.dateOfBirth = fromDateOnly(input.dateOfBirth ?? null);
  if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl;
  if (input.addressLine1 !== undefined) data.addressLine1 = input.addressLine1;
  if (input.addressLine2 !== undefined) data.addressLine2 = input.addressLine2;
  if (input.cityId !== undefined) data.cityId = input.cityId;
  if (input.stateCode !== undefined) data.stateCode = input.stateCode;
  if (input.countryCode !== undefined) data.countryCode = input.countryCode;
  if (input.zip !== undefined) data.zip = input.zip;

  return data;
}

/**
 * Admin edit of another member: their profile, their job title, their access, or
 * whether they are active in this org.
 *
 * Refused in these cases, each of which would break or escalate the model:
 *  - the target is the organization owner (their access is absolute by definition)
 *  - you are changing your own membership (self-escalation / self-lockout) — use
 *    `updateMyProfile`, which cannot touch role, access or active state
 *  - the target template or role is the Owner one (ownership is not grantable)
 *  - the template or role belongs to another org, or doesn't exist
 *
 * The self guard is what makes the two-route split safe: this endpoint requires
 * `member:update` and can change authorization, so letting it address the caller
 * would hand anyone holding it a self-promotion. `updateMyProfile` is the
 * unprivileged door and only opens onto name and contact details.
 */
export async function updateMember(
  actingUserId: string,
  organizationId: string,
  membershipId: string,
  input: UpdateMemberInput,
): Promise<PublicMember> {
  const row = await runAsTenant(organizationId, async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { id: membershipId, organizationId, isDeleted: false },
      select: { id: true, isOwner: true, userId: true, firstName: true, lastName: true },
    });
    if (!membership) throw ApiError.notFound('User not found.');

    if (membership.isOwner && membership.userId !== actingUserId) {
      throw new ApiError(403, "The organization owner's record cannot be changed by other members.");
    }

    const isEscalating = 
      input.permissionTemplateId !== undefined || 
      input.roleId !== undefined || 
      input.isActive !== undefined;

    if (membership.userId === actingUserId && isEscalating) {
      throw new ApiError(
        403,
        'You cannot change your own role, permissions or status. Edit your own details under your profile.',
      );
    }

    const data: Record<string, unknown> = {
      ...membershipNameData(input, membership),
      updatedBy: actingUserId,
    };

    if (input.permissionTemplateId !== undefined) {
      await assertAssignableTemplate(tx, organizationId, input.permissionTemplateId);
      data.permissionTemplateId = input.permissionTemplateId;
    }

    // `null` clears the title; a uuid must resolve to a role in this org.
    if (input.roleId !== undefined) {
      if (input.roleId !== null) await assertAssignableRole(tx, organizationId, input.roleId);
      data.roleId = input.roleId;
    }

    // Not a display flag: `tenantContext` filters on `isActive`, so false ends
    // their access to this org on the next request, on every device.
    if (input.isActive !== undefined) data.isActive = input.isActive;

    await tx.membership.updateMany({ where: { id: membershipId, organizationId }, data });

    // The account half, in the SAME transaction: a partial success that renamed
    // someone in this org but silently dropped their new phone number would be worse
    // than either outcome on its own. `users` carries no RLS policy, so it is
    // reachable from inside a tenant transaction — the `id` filter is the scope, and
    // it comes from the membership row we just proved belongs to this organization,
    // never from the request.
    const accountData = accountDetailData(input);
    if (Object.keys(accountData).length > 0) {
      await tx.user.update({ where: { id: membership.userId }, data: accountData });
    }

    const updated = await tx.membership.findFirst({
      where: { id: membershipId, organizationId },
      select: MEMBER_SELECT,
    });

    const tree = await loadRoleTree(tx, organizationId);
    return { row: updated as MemberRow, tree };
  });

  // After the transaction commits, and outside it: a rename changes what every
  // "Created by"/"Modified by" in the org renders, and the invalidation is an HTTP
  // call to Catalyst Cache — holding a Postgres transaction open across a network
  // round trip to another service is time the connection is doing nothing.
  await invalidateMemberDirectory(organizationId);

  const directory = await getMemberDirectory(organizationId);
  return toPublicMember(row.row, row.tree, directory.actorName(row.row.createdBy));
}

/**
 * A member editing their own record in this organization.
 *
 * 🔴 Changing your name here does NOT change it in any other organization, and does
 * not touch the account name on `User` used by emails, signup and the org picker.
 * That separation is the entire point of per-org profiles — see the `Membership`
 * schema comment. The UI must label the two fields distinctly ("Your name in
 * <Org>" vs "Account name") or people will change one and report the other as
 * broken.
 *
 * The owner is allowed through: this endpoint cannot alter role, access or active
 * state, so there is nothing here for an owner to escalate — and refusing would
 * leave them the one person who cannot fix a typo in their own name.
 */
export async function updateMyProfile(
  actingUserId: string,
  organizationId: string,
  input: UpdateMyProfileInput,
): Promise<PublicMember> {
  const result = await runAsTenant(organizationId, async (tx) => {
    // Addressed by (user, org), never by an id from the request — that is what
    // makes this route safe without a permission check.
    const membership = await tx.membership.findFirst({
      where: { userId: actingUserId, organizationId, isDeleted: false },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!membership) throw ApiError.notFound('You are not a member of this organization.');

    await tx.membership.updateMany({
      where: { id: membership.id, organizationId },
      data: { ...membershipNameData(input, membership), updatedBy: actingUserId },
    });

    // Your own account details. Unlike the name above, these are NOT scoped to this
    // organization — changing your phone number here changes it everywhere you are a
    // member. Addressed by `actingUserId` from the verified session, never by an id
    // in the request.
    const accountData = accountDetailData(input);
    if (Object.keys(accountData).length > 0) {
      await tx.user.update({ where: { id: actingUserId }, data: accountData });
    }

    const updated = await tx.membership.findFirst({
      where: { id: membership.id, organizationId },
      select: MEMBER_SELECT,
    });

    const tree = await loadRoleTree(tx, organizationId);
    return { row: updated as MemberRow, tree };
  });

  // Same reasoning as `updateMember`: after commit, outside the transaction.
  await invalidateMemberDirectory(organizationId);

  const directory = await getMemberDirectory(organizationId);
  return toPublicMember(result.row, result.tree, directory.actorName(result.row.createdBy));
}

/** The caller's own record in this org, for the "Your details" form. */
export async function getMyProfile(
  actingUserId: string,
  organizationId: string,
): Promise<PublicMember> {
  const directory = await getMemberDirectory(organizationId);

  return runAsTenant(organizationId, async (tx) => {
    const row = await tx.membership.findFirst({
      where: { userId: actingUserId, organizationId, isDeleted: false },
      select: MEMBER_SELECT,
    });
    if (!row) throw ApiError.notFound('You are not a member of this organization.');

    const tree = await loadRoleTree(tx, organizationId);
    return toPublicMember(row as MemberRow, tree, directory.actorName(row.createdBy));
  });
}

/**
 * Remove a member from the organization (soft delete). The owner and yourself are
 * both off-limits — an org must always keep its owner, and removing yourself is an
 * account action, not a member-management one.
 *
 * The row stays, which is what keeps their name resolvable in every
 * "Created by"/"Modified by" on work they did before leaving. Deactivating
 * (`isActive: false`) is the reversible alternative and is what the Users screen
 * offers first.
 */
export async function removeMember(
  actingUserId: string,
  organizationId: string,
  membershipId: string,
): Promise<void> {
  await runAsTenant(organizationId, async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { id: membershipId, organizationId, isDeleted: false },
      select: { id: true, isOwner: true, userId: true },
    });
    if (!membership) throw ApiError.notFound('User not found.');

    if (membership.isOwner) {
      throw new ApiError(403, 'The organization owner cannot be removed.');
    }
    if (membership.userId === actingUserId) {
      throw new ApiError(403, 'You cannot remove yourself from the organization.');
    }

    await tx.membership.updateMany({
      where: { id: membershipId, organizationId },
      data: { isDeleted: true, isActive: false, updatedBy: actingUserId },
    });
  });

  // The directory keeps soft-deleted rows on purpose (former members must still
  // resolve their name on work they did), but the cached copy predates this write —
  // drop it so the row's left-the-org state is picked up. After commit, outside the
  // transaction.
  await invalidateMemberDirectory(organizationId);
}
