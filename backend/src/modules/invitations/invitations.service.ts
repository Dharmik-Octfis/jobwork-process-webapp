import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '../../db/prisma.ts';
import { ApiError } from '../../lib/apiError.ts';
import { env } from '../../config/env.ts';
import { hashPassword } from '../../lib/password.ts';
import { sendInvitationEmail } from '../../lib/mailer.ts';
import { issueTokens } from '../auth/auth.service.ts';
import type { CreateInvitationInput, AcceptInvitationInput } from './invitations.schemas.ts';
import type {
  PublicInvitation,
  InvitationLookupResult,
  AcceptInvitationResult,
} from './invitations.types.ts';

/** Roles allowed to send/manage invitations. */
const ORG_ADMIN_ROLES = ['owner', 'admin'];
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * The emailed token is a random secret; only its SHA-256 hash is stored, so a
 * leaked DB row can't be replayed. Lookups re-hash the incoming raw token and
 * match on the hash — the raw value is never queried or logged.
 */
function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** Throw 403 unless `userId` is an owner/admin of `organizationId`. */
async function assertOrgAdmin(userId: string, organizationId: string): Promise<void> {
  const membership = await prisma.membership.findUnique({
    where: {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Prisma compound-unique key
      userId_organizationId: { userId, organizationId },
    },
    select: { role: true },
  });

  if (!membership || !ORG_ADMIN_ROLES.includes(membership.role)) {
    throw new ApiError(403, 'You do not have permission to manage this organization.');
  }
}

function toPublicInvitation(invite: {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  invitedBy: { fullName: string };
}): PublicInvitation {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    status: invite.status,
    invitedByName: invite.invitedBy.fullName,
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
  };
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
  await assertOrgAdmin(inviterId, organizationId);

  // Already a member? Nothing to invite. Checked via the user's membership so a
  // registered member with a differently-cased email is still caught (citext).
  const existingMember = await prisma.membership.findFirst({
    where: { organizationId, user: { email: input.email } },
    select: { id: true },
  });
  if (existingMember) {
    throw ApiError.conflict('That person is already a member of this organization.');
  }

  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const invite = await prisma.invitation.upsert({
    where: {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Prisma compound-unique key
      organizationId_email: { organizationId, email: input.email },
    },
    create: {
      organizationId,
      email: input.email,
      role: input.role,
      tokenHash,
      invitedById: inviterId,
      expiresAt,
      createdBy: inviterId,
      updatedBy: inviterId,
    },
    // Re-invite: reset everything a stale/revoked/accepted row might carry.
    update: {
      role: input.role,
      tokenHash,
      status: 'pending',
      invitedById: inviterId,
      expiresAt,
      acceptedAt: null,
      updatedBy: inviterId,
    },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      organization: { select: { name: true } },
      invitedBy: { select: { fullName: true } },
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

/** Pending invitations for an org (owner/admin only). */
export async function listInvitations(
  userId: string,
  organizationId: string,
): Promise<PublicInvitation[]> {
  await assertOrgAdmin(userId, organizationId);

  const invites = await prisma.invitation.findMany({
    where: { organizationId, status: 'pending' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      invitedBy: { select: { fullName: true } },
    },
  });

  return invites.map(toPublicInvitation);
}

/** Revoke a pending invitation (owner/admin only). Idempotent-ish: a missing or
 * already-final invite is treated as already revoked. */
export async function revokeInvitation(
  userId: string,
  organizationId: string,
  invitationId: string,
): Promise<void> {
  await assertOrgAdmin(userId, organizationId);

  // Scope the update to this org so an admin can't revoke another org's invite
  // by guessing an id.
  await prisma.invitation.updateMany({
    where: { id: invitationId, organizationId, status: 'pending' },
    data: { status: 'revoked', updatedBy: userId },
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
      role: true,
      status: true,
      expiresAt: true,
      organization: { select: { name: true } },
    },
  });

  if (!invite) {
    return {
      status: 'invalid',
      organizationName: null,
      email: null,
      role: null,
      accountExists: false,
    };
  }

  const accountExists = (await prisma.user.count({ where: { email: invite.email } })) > 0;

  const base = {
    organizationName: invite.organization.name,
    email: invite.email,
    role: invite.role,
    accountExists,
  };

  if (invite.status === 'accepted') return { ...base, status: 'accepted' };
  if (invite.status === 'revoked') return { ...base, status: 'revoked' };
  if (invite.expiresAt < new Date()) return { ...base, status: 'expired' };
  return { ...base, status: 'valid' };
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
): Promise<AcceptInvitationResult> {
  const invite = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      organizationId: true,
      organization: { select: { id: true, name: true } },
    },
  });

  if (!invite) {
    throw new ApiError(404, 'This invitation is invalid.');
  }
  if (invite.status === 'accepted') {
    throw ApiError.conflict('This invitation has already been accepted.');
  }
  if (invite.status === 'revoked') {
    throw new ApiError(410, 'This invitation has been revoked.');
  }
  if (invite.expiresAt < new Date()) {
    throw new ApiError(410, 'This invitation has expired. Ask for a new one.');
  }

  const org = { id: invite.organization.id, name: invite.organization.name };

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

    await prisma.$transaction([
      prisma.membership.upsert({
        where: {
          // eslint-disable-next-line @typescript-eslint/naming-convention -- Prisma compound-unique key
          userId_organizationId: { userId: currentUser.id, organizationId: invite.organizationId },
        },
        create: {
          userId: currentUser.id,
          organizationId: invite.organizationId,
          role: invite.role,
          createdBy: currentUser.id,
          updatedBy: currentUser.id,
        },
        update: {}, // already a member → leave their existing role untouched
      }),
      prisma.invitation.update({
        where: { id: invite.id },
        data: { status: 'accepted', acceptedAt: new Date(), updatedBy: currentUser.id },
      }),
    ]);

    return { organization: org, role: invite.role, autoLogin: null };
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
      },
      select: { id: true, firstName: true, lastName: true, fullName: true, email: true },
    });

    await tx.membership.create({
      data: {
        userId: created.id,
        organizationId: invite.organizationId,
        role: invite.role,
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

  const autoLogin = await issueTokens(newUser);
  return { organization: org, role: invite.role, autoLogin };
}
