import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../../../db/prisma.ts';
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

afterAll(async () => {
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
  it('sends a user with no memberships to /no-access, and creates no organization', async () => {
    const user = await makeUser();
    const orgsBefore = await prisma.organization.count();

    expect(await landingPathFor(user.id)).toBe('/no-access');

    // Inventing a tenant here would hand every new identity its own empty company.
    expect(await prisma.organization.count()).toBe(orgsBefore);
  });
});
