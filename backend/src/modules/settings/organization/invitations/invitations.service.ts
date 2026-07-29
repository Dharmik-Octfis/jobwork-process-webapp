import { randomBytes, createHash } from 'node:crypto';
import { prisma, runAsTenant } from '../../../../db/prisma.ts';
import { ApiError } from '../../../../lib/apiError.ts';
import { env } from '../../../../config/env.ts';
import { hashPassword } from '../../../../lib/password.ts';
import { sendInvitationEmail } from '../../../../lib/mailer.ts';
import { issueTokens, formatPublicUser } from '../../../auth/auth.service.ts';
import type { CreateInvitationInput, AcceptInvitationInput } from './invitations.schemas.ts';
import type {
  PublicInvitation,
  InvitationLookupResult,
  AcceptInvitationResult,
  MyInvitation,
} from './invitations.types.ts';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Send throttling. Every call to createInvitation sends an email, so without a
 * limit an admin account is an email-bombing tool aimed at any address, and a
 * reputation risk for our sending domain.
 *
 * Two independent guards, because they stop different abuse:
 *  - COOLDOWN caps how often ONE address can be mailed (hammering one person).
 *  - ORG_HOURLY_LIMIT caps how many DIFFERENT people one org can mail per hour
 *    (spraying many addresses).
 *
 * Both are enforced in the database, not in memory: AppSail runs many short-lived
 * instances, so an in-process counter would reset constantly and each instance
 * would keep its own — i.e. no limit at all.
 */
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between emails to the same address
const ORG_HOURLY_LIMIT = 20; // distinct recipients an org may email per hour

/**
 * The emailed token is a random secret; only its SHA-256 hash is stored, so a
 * leaked DB row can't be replayed. Lookups re-hash the incoming raw token and
 * match on the hash — the raw value is never queried or logged.
 */
function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

// `assertOrgAdmin` lived here until 2026-07-25. It was a second authorization
// system: it read the old `memberships.role` string, accepted 'owner' or 'admin',
// and ignored the permission catalog — so a member holding `member:create` still
// could not invite anyone. Its callers (this module and custom fields) now mount
// `authenticate, tenantContext` and carry a `requirePermission` per route, which
// also makes the membership/isDeleted lookup it did by hand redundant:
// tenantContext already filters `isDeleted` on both the membership and the org.

function toPublicInvitation(invite: {
  id: string;
  email: string;
  roleId: string | null;
  permissionTemplateId: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  invitedBy: { fullName: string };
  role: { name: string } | null;
  permissionTemplate: { name: string };
}): PublicInvitation {
  return {
    id: invite.id,
    email: invite.email,
    roleId: invite.roleId,
    roleName: invite.role?.name ?? null,
    permissionTemplateId: invite.permissionTemplateId,
    permissionTemplateName: invite.permissionTemplate.name,
    status: invite.status,
    invitedByName: invite.invitedBy.fullName,
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
  };
}

/**
 * Throttle invite emails. Throws 429 when either guard trips. Checked before the
 * upsert so a rejected send neither rotates the token nor touches the row — a
 * rate-limited retry must not invalidate the link already in someone's inbox.
 */
async function assertSendAllowed(organizationId: string, email: string): Promise<void> {
  const now = Date.now();

  // Guard 1 — per recipient. `lastSentAt` is on the recycled row, so this holds
  // however many times the same address is re-invited.
  const existing = await prisma.invitation.findUnique({
    where: {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Prisma compound-unique key
      organizationId_email: { organizationId, email },
    },
    select: { lastSentAt: true },
  });

  if (existing?.lastSentAt) {
    const elapsed = now - existing.lastSentAt.getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      throw new ApiError(
        429,
        `An invitation was just sent to this address. Try again in ${wait} second${wait === 1 ? '' : 's'}.`,
      );
    }
  }

  // Guard 2 — per organization. Counts distinct recipients mailed in the last
  // hour; combined with the cooldown above that bounds total sends per org.
  const recentRecipients = await prisma.invitation.count({
    where: { organizationId, lastSentAt: { gte: new Date(now - 60 * 60 * 1000) } },
  });

  if (recentRecipients >= ORG_HOURLY_LIMIT) {
    throw new ApiError(
      429,
      'This organization has sent too many invitations in the last hour. Please try again later.',
    );
  }
}

/**
 * Resolve the access an invite is about to grant, proving the template belongs to
 * this org and may actually be handed out. The Owner template is refused:
 * ownership comes from creating the organization, never from an invitation.
 */
async function assertInvitableTemplate(
  organizationId: string,
  permissionTemplateId: string,
): Promise<void> {
  const template = await runAsTenant(organizationId, (tx) =>
    tx.permissionTemplate.findFirst({
      where: { id: permissionTemplateId, organizationId, isDeleted: false },
      select: { isSystem: true },
    }),
  );

  if (!template) {
    throw ApiError.badRequest(
      'That permission template does not exist. Create one before inviting someone.',
    );
  }
  // `isSystem` is the Owner template — the one row that is never handed out. The
  // seeded "Full access" / "View only" templates are ordinary rows and invitable.
  if (template.isSystem) {
    throw new ApiError(403, 'The Owner permission template cannot be granted by invitation.');
  }
}

/**
 * Same check for the job title, when one was chosen. A title grants nothing, but
 * it still has to be a real role in THIS org — otherwise an id from another
 * tenant would be written straight onto the invitation. The seeded Owner role is
 * refused for the same reason its template is.
 */
async function assertInvitableRole(organizationId: string, roleId: string): Promise<void> {
  const role = await runAsTenant(organizationId, (tx) =>
    tx.role.findFirst({
      where: { id: roleId, organizationId, isDeleted: false },
      select: { isSystem: true },
    }),
  );

  if (!role) throw ApiError.badRequest('That role does not exist.');
  if (role.isSystem) {
    throw new ApiError(403, 'The Owner role cannot be granted by invitation.');
  }
}

/**
 * Create (or refresh) an invitation and email its accept link.
 *
 * We invite an *email*, not a user — the recipient may have no account yet.
 * Re-inviting the same email upserts the one row (`@@unique(orgId, email)`),
 * minting a fresh token and expiry, so a lost invite can simply be re-sent.
 */
export async function createInvitation(
  inviterId: string,
  organizationId: string,
  input: CreateInvitationInput,
): Promise<PublicInvitation> {
  // Authorization is the route's job now (`requirePermission('member:create')`).
  await assertInvitableTemplate(organizationId, input.permissionTemplateId);
  if (input.roleId) await assertInvitableRole(organizationId, input.roleId);

  // Already an ACTIVE member? Nothing to invite. Checked via the user's membership
  // so a registered member with a differently-cased email is still caught (citext).
  // `isDeleted: false` matters: removal is a soft delete, so without it a person
  // who was removed could never be re-invited — the row lingers and this 409s
  // forever. Accept reactivates that same row (see acceptInvitation).
  const existingMember = await prisma.membership.findFirst({
    where: { organizationId, isDeleted: false, user: { email: input.email } },
    select: { id: true },
  });
  if (existingMember) {
    throw ApiError.conflict('That person is already a member of this organization.');
  }

  await assertSendAllowed(organizationId, input.email);

  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

  const invite = await prisma.invitation.upsert({
    where: {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Prisma compound-unique key
      organizationId_email: { organizationId, email: input.email },
    },
    create: {
      organizationId,
      email: input.email,
      roleId: input.roleId ?? null,
      permissionTemplateId: input.permissionTemplateId,
      tokenHash,
      invitedById: inviterId,
      expiresAt,
      sendCount: 1,
      lastSentAt: now,
      createdBy: inviterId,
      updatedBy: inviterId,
    },
    // Re-invite: reset everything a stale/revoked/declined/accepted row carries.
    update: {
      roleId: input.roleId ?? null,
      permissionTemplateId: input.permissionTemplateId,
      tokenHash,
      status: 'pending',
      invitedById: inviterId,
      expiresAt,
      acceptedAt: null,
      declinedAt: null,
      sendCount: { increment: 1 },
      lastSentAt: now,
      updatedBy: inviterId,
    },
    select: {
      id: true,
      email: true,
      roleId: true,
      permissionTemplateId: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      organization: { select: { name: true } },
      invitedBy: { select: { fullName: true } },
      role: { select: { name: true } },
      permissionTemplate: { select: { name: true } },
    },
  });

  const inviteLink = `${env.appUrl}/invite/accept?token=${rawToken}`;
  await sendInvitationEmail({
    to: invite.email,
    inviteLink,
    organizationName: invite.organization.name,
  });

  return toPublicInvitation(invite);
}

/** Pending invitations for an org. Gated by `member:read` on the route. */
export async function listInvitations(organizationId: string): Promise<PublicInvitation[]> {
  // `declined` is included on purpose — the whole point of a decline is that the
  // admin sees it, rather than watching an invite expire silently a week later.
  const invites = await prisma.invitation.findMany({
    where: { organizationId, status: { in: ['pending', 'declined'] } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      roleId: true,
      permissionTemplateId: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      invitedBy: { select: { fullName: true } },
      role: { select: { name: true } },
      permissionTemplate: { select: { name: true } },
    },
  });

  return invites.map(toPublicInvitation);
}

/** Revoke a pending invitation. Idempotent-ish: a missing or already-final invite
 * is treated as already revoked. Gated by `member:create` on the route. */
export async function revokeInvitation(
  userId: string,
  organizationId: string,
  invitationId: string,
): Promise<void> {
  // Scope the update to this org so an admin can't revoke another org's invite
  // by guessing an id.
  await prisma.invitation.updateMany({
    where: { id: invitationId, organizationId, status: 'pending' },
    data: { status: 'revoked', updatedBy: userId },
  });
}

/**
 * Decline an invitation from the public accept page. The raw token is the
 * credential — no session required, exactly like accept, because the invitee may
 * have no account.
 *
 * Declining is deliberately terminal-but-reversible: it only moves a `pending`
 * row to `declined`, and re-inviting resets it to `pending` (see createInvitation).
 * Its real job is to tell the admin "they said no" instead of leaving the invite
 * to expire silently a week later.
 */
export async function declineInvitation(rawToken: string): Promise<void> {
  const invite = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { id: true, status: true },
  });

  if (!invite) {
    throw new ApiError(404, 'This invitation is invalid.');
  }
  if (invite.status === 'accepted') {
    throw ApiError.conflict('This invitation has already been accepted.');
  }

  // Scoped to `pending`, so declining twice — or declining something already
  // revoked — is a harmless no-op rather than an error the UI has to explain.
  await prisma.invitation.updateMany({
    where: { id: invite.id, status: 'pending' },
    data: { status: 'declined', declinedAt: new Date() },
  });
}

/**
 * Resolve a raw token for the public accept page. Never throws for a bad token —
 * it returns a `status` the page renders, so probing a token tells an attacker
 * nothing beyond "this string isn't a live invite".
 */
export async function getInvitationByToken(rawToken: string): Promise<InvitationLookupResult> {
  const invite = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      email: true,
      status: true,
      expiresAt: true,
      organization: { select: { name: true } },
      role: { select: { name: true } },
      permissionTemplate: { select: { name: true } },
    },
  });

  if (!invite) {
    return {
      status: 'invalid',
      organizationName: null,
      email: null,
      roleName: null,
      permissionTemplateName: null,
      accountExists: false,
    };
  }

  const accountExists = (await prisma.user.count({ where: { email: invite.email } })) > 0;

  const base = {
    organizationName: invite.organization.name,
    email: invite.email,
    roleName: invite.role?.name ?? null,
    permissionTemplateName: invite.permissionTemplate.name,
    accountExists,
  };

  if (invite.status === 'accepted') return { ...base, status: 'accepted' };
  if (invite.status === 'revoked') return { ...base, status: 'revoked' };
  if (invite.status === 'declined') return { ...base, status: 'declined' };
  if (invite.expiresAt < new Date()) return { ...base, status: 'expired' };
  return { ...base, status: 'valid' };
}

// ── The in-app invitation inbox ──────────────────────────────────────────────
//
// A second way to reach an invitation, for people who ARE signed in. It exists
// because the emailed token is unrecoverable: only its SHA-256 hash is stored, so
// the app can never hand the token back to the UI. The inbox therefore addresses
// invitations by **id**, and replaces the token with a stronger credential — the
// caller must be signed in AS the invited email.
//
// The invited email is always read from the DB user record, never from the
// request, or this becomes an invitation-enumeration endpoint.

/** The signed-in user's identity, read from the database. Never trust an email
 * supplied by the request — that is what would make this an enumeration tool. */
async function requireUser(userId: string): Promise<{ id: string; email: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) {
    throw new ApiError(401, 'Your session is no longer valid. Please sign in again.');
  }
  return user;
}

/**
 * The inbox's authorization check, standing in for the token: you may act on an
 * invitation only if you are signed in as the address it was sent to.
 *
 * A missing invitation and someone else's invitation raise the SAME 404 on
 * purpose — distinguishing them would let a signed-in user probe ids to discover
 * who else has been invited where.
 */
function assertAddressedToMe<T extends { email: string }>(
  invite: T | null,
  userEmail: string,
): asserts invite is T {
  if (!invite || invite.email.toLowerCase() !== userEmail.toLowerCase()) {
    throw new ApiError(404, 'This invitation is invalid.');
  }
}

/** Live invitations addressed to the signed-in user. Drives the "You have an
 * invitation" prompt — the answer to "I lost the email, where do I find it?". */
export async function listMyInvitations(userId: string): Promise<MyInvitation[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user) {
    throw new ApiError(401, 'Your session is no longer valid. Please sign in again.');
  }

  const invites = await prisma.invitation.findMany({
    where: {
      email: user.email, // citext column → case-insensitive match, no manual lowering
      status: 'pending',
      expiresAt: { gt: new Date() },
      organization: { isDeleted: false },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      organizationId: true,
      expiresAt: true,
      createdAt: true,
      organization: { select: { name: true } },
      role: { select: { name: true } },
      permissionTemplate: { select: { name: true } },
      invitedBy: { select: { fullName: true } },
    },
  });

  return invites.map((i) => ({
    id: i.id,
    organizationId: i.organizationId,
    organizationName: i.organization.name,
    roleName: i.role?.name ?? null,
    permissionTemplateName: i.permissionTemplate.name,
    invitedByName: i.invitedBy.fullName,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  }));
}

/** Accept from the inbox. Same join logic as the emailed link — only how the
 * caller proved their claim to it differs. */
export async function acceptMyInvitation(
  userId: string,
  invitationId: string,
): Promise<AcceptInvitationResult> {
  const user = await requireUser(userId);

  const invite = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: {
      id: true,
      email: true,
      roleId: true,
      permissionTemplateId: true,
      status: true,
      expiresAt: true,
      organizationId: true,
      organization: { select: { id: true, name: true } },
      role: { select: { name: true } },
      permissionTemplate: { select: { name: true } },
    },
  });

  assertAddressedToMe(invite, user.email);
  assertInviteLive(invite);
  await joinOrganization(invite, user.id);

  return {
    organization: { id: invite.organization.id, name: invite.organization.name },
    roleName: invite.role?.name ?? null,
    permissionTemplateName: invite.permissionTemplate.name,
    // Already signed in — no session to issue, unlike the anonymous token flow.
    autoLogin: null,
  };
}

/** Decline from the inbox. Unlike the token flow this records WHO declined,
 * because the caller is authenticated. */
export async function declineMyInvitation(userId: string, invitationId: string): Promise<void> {
  const user = await requireUser(userId);

  const invite = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { id: true, email: true, status: true },
  });

  assertAddressedToMe(invite, user.email);

  if (invite.status === 'accepted') {
    throw ApiError.conflict('This invitation has already been accepted.');
  }

  // Scoped to `pending`, so declining twice is a harmless no-op.
  await prisma.invitation.updateMany({
    where: { id: invite.id, status: 'pending' },
    data: { status: 'declined', declinedAt: new Date(), updatedBy: userId },
  });
}

/**
 * The four terminal states an invite can be in. Shared by BOTH accept paths — the
 * emailed token and the in-app inbox — so the two can never drift apart on what
 * counts as still-acceptable.
 */
function assertInviteLive(invite: { status: string; expiresAt: Date }): void {
  if (invite.status === 'accepted') {
    throw ApiError.conflict('This invitation has already been accepted.');
  }
  if (invite.status === 'revoked') {
    throw new ApiError(410, 'This invitation has been revoked.');
  }
  if (invite.status === 'declined') {
    throw new ApiError(410, 'This invitation was declined. Ask for a new one.');
  }
  if (invite.expiresAt < new Date()) {
    throw new ApiError(410, 'This invitation has expired. Ask for a new one.');
  }
}

/**
 * Create-or-reactivate the membership and mark the invite accepted, in ONE
 * transaction. The single place joining is implemented, shared by the token flow
 * and the inbox flow — the membership upsert has subtle soft-delete semantics
 * (see below) that must not be duplicated and half-remembered.
 */
async function joinOrganization(
  invite: {
    id: string;
    organizationId: string;
    roleId: string | null;
    permissionTemplateId: string;
  },
  userId: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.membership.upsert({
      where: {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- Prisma compound-unique key
        userId_organizationId: { userId, organizationId: invite.organizationId },
      },
      create: {
        userId,
        organizationId: invite.organizationId,
        // No isOwner: ownership comes from creating the org, never from an invite.
        // Authorization comes from permissionTemplateId; roleId is the job title,
        // which grants nothing.
        roleId: invite.roleId,
        permissionTemplateId: invite.permissionTemplateId,
        createdBy: userId,
        updatedBy: userId,
      },
      // A row already exists for this (user, org). Because `@@unique([userId,
      // organizationId])` is a plain unique index, a soft-deleted row still
      // occupies the key — a second row is impossible, so re-joining MUST
      // reactivate this one (CLAUDE.md, "Unique constraints + soft delete").
      // `createdBy`/`createdAt` are deliberately NOT touched: they stay the
      // original join record, so the first-joined date survives a rejoin.
      update: {
        isDeleted: false,
        roleId: invite.roleId,
        permissionTemplateId: invite.permissionTemplateId,
        updatedBy: userId,
      },
    }),
    prisma.invitation.update({
      where: { id: invite.id },
      data: { status: 'accepted', acceptedAt: new Date(), updatedBy: userId },
    }),
  ]);
}

/**
 * Accept an invitation. Serves both callers on one endpoint:
 *
 *  - **Logged-in user** (`currentUserId` set): their email must match the
 *    invited email; a Membership is created (idempotently) and the invite marked
 *    accepted.
 *  - **Anonymous new user**: `firstName`/`lastName`/`password` create the account
 *    together with the Membership in one transaction, and `autoLogin` is
 *    returned so the controller can sign them straight in.
 *
 * An anonymous accept for an email that *already* has an account is refused with
 * `ACCOUNT_EXISTS`, so the client can send them to sign in first.
 */
export async function acceptInvitation(
  rawToken: string,
  currentUserId: string | null,
  input: AcceptInvitationInput,
  userAgent: string,
): Promise<AcceptInvitationResult> {
  const invite = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      id: true,
      email: true,
      roleId: true,
      permissionTemplateId: true,
      status: true,
      expiresAt: true,
      organizationId: true,
      organization: { select: { id: true, name: true } },
      role: { select: { name: true } },
      permissionTemplate: { select: { name: true } },
    },
  });

  if (!invite) {
    throw new ApiError(404, 'This invitation is invalid.');
  }
  assertInviteLive(invite);

  const org = { id: invite.organization.id, name: invite.organization.name };
  const roleName = invite.role?.name ?? null;
  const permissionTemplateName = invite.permissionTemplate.name;

  // ── Case A: a logged-in user is accepting ──────────────────────────────────
  if (currentUserId) {
    const currentUser = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { id: true, email: true },
    });
    if (!currentUser) {
      throw new ApiError(401, 'Your session is no longer valid. Please sign in again.');
    }

    // citext email compare — the invite and the account must be the same person.
    if (currentUser.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new ApiError(
        403,
        `This invitation was sent to ${invite.email}. Sign in with that account to accept it.`,
      );
    }

    await joinOrganization(invite, currentUser.id);

    return { organization: org, roleName, permissionTemplateName, autoLogin: null };
  }

  // ── Case B: anonymous acceptor ─────────────────────────────────────────────
  const existingUser = await prisma.user.findUnique({
    where: { email: invite.email },
    select: { id: true },
  });

  if (existingUser) {
    // They have an account but aren't signed in — the client should send them to
    // log in, then re-call this endpoint with a Bearer token (Case A).
    throw new ApiError(
      409,
      'You already have an account. Please sign in to accept this invitation.',
      {
        code: 'ACCOUNT_EXISTS',
      },
    );
  }

  if (!input.firstName || !input.lastName || !input.password) {
    throw ApiError.badRequest('Enter your name and a password to accept this invitation.');
  }

  const passwordHash = await hashPassword(input.password);
  const fullName = `${input.firstName} ${input.lastName}`.trim();

  const newUser = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: invite.email,
        firstName: input.firstName!,
        lastName: input.lastName!,
        fullName,
        passwordHash,
        userAgent,
      },
      select: { id: true, firstName: true, lastName: true, fullName: true, email: true, userAgent: true },
    });

    await tx.membership.create({
      data: {
        userId: created.id,
        organizationId: invite.organizationId,
        // No isOwner: ownership comes from creating the org, never from an invite.
        // Authorization comes from permissionTemplateId; roleId is the job title,
        // which grants nothing.
        roleId: invite.roleId,
        permissionTemplateId: invite.permissionTemplateId,
        // Self-service accept: the new user is the actor for their own membership.
        createdBy: created.id,
        updatedBy: created.id,
      },
    });

    await tx.invitation.update({
      where: { id: invite.id },
      data: { status: 'accepted', acceptedAt: new Date(), updatedBy: created.id },
    });

    return created;
  });

  const autoLogin = await issueTokens(await formatPublicUser(newUser));
  return { organization: org, roleName, permissionTemplateName, autoLogin };
}
