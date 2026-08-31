import { describe, it, expect, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { landingPathFor, linkOrCreateLocalUser, safeReturnTo } from './sso.service.ts';

/**
 * Regression guards for the SSO client half — docs/SSO_AND_IDENTITY.md §9.
 *
 * Every assertion here corresponds to a decision that fails SILENTLY if reversed.
 * None of these produce a crash or a type error when broken: entitlement stops
 * refusing, an open redirect starts working, an unverified email starts claiming
 * accounts. That is precisely why they are pinned rather than left to review.
 *
 * 🔴 Every user is created by this file and hard-deleted afterwards. These suites
 * run against the dev database in parallel, so a test that mutates a user it merely
 * *found* would break whatever another suite is doing with it — see the note in
 * middlewares/authenticate.test.ts.
 */

const created: string[] = [];

async function makeUser(
  overrides: { emailVerified?: boolean; isActive?: boolean; isDeleted?: boolean } = {},
) {
  const unique = process.hrtime.bigint().toString(36);
  const { emailVerified: _ignored, ...flags } = overrides;

  const user = await prisma.user.create({
    data: {
      email: `sso-test-${unique}@example.invalid`,
      firstName: 'Sso',
      lastName: 'Probe',
      fullName: 'Sso Probe',
      userAgent: 'unknown',
      ...flags,
    },
    select: { id: true, email: true },
  });
  created.push(user.id);
  return user;
}

/** A `sub` that belongs to no local user. */
function unknownIdentity(): string {
  return crypto.randomUUID();
}

const invitations: string[] = [];

/**
 * A pending invitation to a real organization, addressed to an address nobody owns.
 *
 * 🔴 `permission_templates` is RLS-gated, so it can only be read from inside a
 * tenant context — outside one the policy compares against a null
 * `app.current_tenant` and the lookup silently returns nothing. `organizations` and
 * `invitations` carry no policy on purpose (they are read before a tenant exists),
 * which is why only the template needs `runAsTenant`.
 *
 * The organization and template are FOUND, never modified; the inviter and the
 * invitation itself are created here and deleted afterwards.
 */
async function makeInvitation(
  overrides: {
    status?: string;
    expiresAt?: Date;
    acceptedAt?: Date;
    isDeleted?: boolean;
  } = {},
) {
  const org = await prisma.organization.findFirst({
    where: { isDeleted: false },
    select: { id: true },
  });
  if (!org) throw new Error('no organization in the dev database to invite into');

  const template = await runAsTenant(org.id, (tx) =>
    tx.permissionTemplate.findFirst({
      where: { organizationId: org.id, isDeleted: false },
      select: { id: true },
    }),
  );
  if (!template) throw new Error('no permission template to attach the invitation to');

  const inviter = await makeUser();
  const unique = process.hrtime.bigint().toString(36);
  const email = `sso-invitee-${unique}@example.invalid`;

  const invitation = await prisma.invitation.create({
    data: {
      organizationId: org.id,
      email,
      tokenHash: `sso-test-${unique}`,
      status: overrides.status ?? 'pending',
      invitedById: inviter.id,
      permissionTemplateId: template.id,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 7 * 864e5),
      acceptedAt: overrides.acceptedAt ?? null,
      isDeleted: overrides.isDeleted ?? false,
    },
    select: { id: true, email: true },
  });
  invitations.push(invitation.id);
  return invitation;
}

afterAll(async () => {
  // Invitations first — they reference the inviter through `invited_by_id`.
  await prisma.invitation.deleteMany({ where: { id: { in: invitations } } });
  await prisma.user.deleteMany({ where: { id: { in: created } } });
});

describe('§9.3 — per-app entitlement fails closed', () => {
  it('refuses an identity with no local user, and creates nothing', async () => {
    const sub = unknownIdentity();
    const email = `sso-stranger-${process.hrtime.bigint().toString(36)}@example.invalid`;

    await expect(linkOrCreateLocalUser({ sub, email, emailVerified: true })).rejects.toThrow(
      ApiError,
    );

    // The assertion that actually matters. An app that auto-provisions here turns
    // every identity in the estate into one of its users, silently.
    expect(
      await prisma.user.count({ where: { OR: [{ email }, { identityUserId: sub }] } }),
      'provisionOrRefuse must not create a local user',
    ).toBe(0);
  });

  it('refuses with 403, not 401 — authenticated, but not entitled', async () => {
    await expect(
      linkOrCreateLocalUser({ sub: unknownIdentity(), emailVerified: false }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('§9.3 — a pending invitation is the ONE way in', () => {
  it('provisions a password-less user when the verified email holds a pending invite', async () => {
    const invite = await makeInvitation();

    const sub = crypto.randomUUID();
    const user = await linkOrCreateLocalUser({
      sub,
      email: invite.email,
      emailVerified: true,
      name: 'Invited Person',
    });
    created.push(user.id);

    expect(user.identityUserId).toBe(sub);
    // 🔴 No local password. Giving one would quietly reopen the login the cutover
    // is closing, for an account that only ever existed through the provider.
    expect(user.passwordHash, 'an SSO-provisioned user must have no password').toBeNull();
  });

  it('🔴 refuses the same invitation when the email is NOT verified', async () => {
    const invite = await makeInvitation();

    // The invite is addressed to an ADDRESS. Without this check, anyone who can
    // register that address without proving they own it walks into the org.
    await expect(
      linkOrCreateLocalUser({
        sub: crypto.randomUUID(),
        email: invite.email,
        emailVerified: false,
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(await prisma.user.count({ where: { email: invite.email } })).toBe(0);
  });

  it('refuses an expired invitation', async () => {
    const invite = await makeInvitation({ expiresAt: new Date(Date.now() - 1000) });

    await expect(
      linkOrCreateLocalUser({ sub: crypto.randomUUID(), email: invite.email, emailVerified: true }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses an already-accepted invitation, so it cannot be reused', async () => {
    const invite = await makeInvitation({ status: 'accepted', acceptedAt: new Date() });

    await expect(
      linkOrCreateLocalUser({ sub: crypto.randomUUID(), email: invite.email, emailVerified: true }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a revoked (soft-deleted) invitation', async () => {
    const invite = await makeInvitation({ isDeleted: true });

    // Revoking an invite has to actually revoke it — otherwise "uninvite" is a
    // button that does nothing.
    await expect(
      linkOrCreateLocalUser({ sub: crypto.randomUUID(), email: invite.email, emailVerified: true }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('does NOT join the organization — that stays in the invitations module', async () => {
    const invite = await makeInvitation();

    const user = await linkOrCreateLocalUser({
      sub: crypto.randomUUID(),
      email: invite.email,
      emailVerified: true,
    });
    created.push(user.id);

    // Membership carries the role, the permission template and the membership name.
    // Granting it here would be a second implementation of the thing that grants
    // access — the accept flow remains the only one.
    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe('§9.2 — linking an identity to a local user', () => {
  it('links a pre-existing user by verified email, once, and stamps the sub', async () => {
    const user = await makeUser();
    const sub = unknownIdentity();

    const linked = await linkOrCreateLocalUser({ sub, email: user.email, emailVerified: true });
    expect(linked.id).toBe(user.id);
    expect(linked.identityUserId).toBe(sub);
  });

  it('🔴 will NOT link when the email is unverified', async () => {
    const user = await makeUser();

    // Without this, anyone who registers at accounts with someone else's
    // unverified address takes over that person's jobwork account.
    await expect(
      linkOrCreateLocalUser({ sub: unknownIdentity(), email: user.email, emailVerified: false }),
    ).rejects.toThrow(ApiError);

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after?.identityUserId, 'an unverified email must not claim an account').toBeNull();
  });

  it('finds an already-linked user by sub, not by email', async () => {
    const user = await makeUser();
    const sub = unknownIdentity();
    await prisma.user.update({ where: { id: user.id }, data: { identityUserId: sub } });

    // No email supplied at all: the sub alone has to be enough, because people
    // change email addresses and `sub` is the permanent join key.
    const found = await linkOrCreateLocalUser({ sub, emailVerified: false });
    expect(found.id).toBe(user.id);
  });

  it('refuses a linked user whose local account is disabled', async () => {
    const user = await makeUser({ isActive: false });
    const sub = unknownIdentity();
    await prisma.user.update({ where: { id: user.id }, data: { identityUserId: sub } });

    // One app revoking access must not require touching the central identity.
    await expect(linkOrCreateLocalUser({ sub, emailVerified: true })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('refuses a soft-deleted user, not just an inactive one', async () => {
    const user = await makeUser({ isDeleted: true });
    const sub = unknownIdentity();
    await prisma.user.update({ where: { id: user.id }, data: { identityUserId: sub } });

    // `isDeleted` is the flag that historically got checked in zero places.
    await expect(linkOrCreateLocalUser({ sub, emailVerified: true })).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('§12 — returnTo must not become an open redirect', () => {
  it('accepts a same-app path', () => {
    expect(safeReturnTo('/organizations/abc')).toBe('/organizations/abc');
  });

  it.each([
    ['an absolute url', 'https://evil.test/steal'],
    ['a protocol-relative url', '//evil.test/steal'],
    ['a backslash-prefixed url', '\\\\evil.test'],
    ['a bare host', 'evil.test'],
    ['a non-string', 42 as unknown as string],
    ['undefined', undefined as unknown as string],
  ])('rejects %s', (_label, value) => {
    // Sign-in succeeds and then hands the browser to whatever host the link named
    // — the classic way a phishing page borrows a real login.
    expect(safeReturnTo(value)).toBeUndefined();
  });
});

describe('§9.4 — landing', () => {
  /**
   * 🔴 The app root, NOT an organization, and never a path this file invented.
   *
   * Two rewrites in one day, both from the same mistake — deciding here something
   * the app decides better. It answered `/no-access` (a route that was never built,
   * so a successful sign-in ended on the catch-all), then `/organizations` for a
   * multi-org user — which meant signing in from jobwork's button reopened your
   * last workspace while signing in at accounts.octfis.com dropped you on a bare
   * picker. `OrgRedirect` owns this, and it knows the last organization used.
   */
  it('sends a sign-in with no deep link to the app root', () => {
    expect(landingPathFor()).toBe('/');
  });

  it('honours a deep link, so an invitation link survives the round trip', () => {
    expect(landingPathFor('/invite/accept?token=abc')).toBe('/invite/accept?token=abc');
  });

  it('creates no organization for a member of nothing', async () => {
    const user = await makeUser();
    const orgsBefore = await prisma.organization.count();

    expect(landingPathFor()).toBe('/');

    // Inventing a tenant here would hand every new identity its own empty company.
    expect(await prisma.organization.count()).toBe(orgsBefore);
    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(0);
  });
});
