import { createHash, randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll, vi } from 'vitest';
import { prisma, runAsTenant } from '../../../../db/prisma.ts';

/**
 * The invitation accept endpoint under SSO — the FIFTH way a local password could
 * be created, and the one the cutover missed until 2026-08-31.
 *
 * `auth.routes.ts` unmounts `/signup`, `/login`, `/forgot-password` and
 * `/reset-password` when SSO is on, and has a long comment about why all four have
 * to go. This endpoint sat outside that guard and did the same thing from a
 * different module: hand it a valid invite token and it created a user with a
 * `passwordHash` and signed them straight in — an account the identity provider
 * knows nothing about and cannot disable.
 *
 * 🔴 This is exactly the shape that needs a test rather than a review: nothing
 * crashes when the guard is removed. The endpoint goes back to working, the invitee
 * gets in, and the only difference is a credential that should not exist.
 */

/**
 * Force the flag on rather than reading the developer's `.env`. The guard is about
 * what happens when SSO is enabled, so the test has to assert that case whatever
 * the local environment happens to be set to — otherwise it quietly stops testing
 * anything the day someone flips the flag to try the rollback path.
 *
 * Everything else in `env` is passed through untouched: `db/prisma.ts` reads its
 * connection string from this same module.
 */
vi.mock('../../../../config/env.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../config/env.ts')>();
  return { env: { ...actual.env, sso: { ...actual.env.sso, enabled: true } } };
});

const { acceptInvitation } = await import('./invitations.service.ts');

const users: string[] = [];
const invitationIds: string[] = [];

/**
 * A pending invitation to a real organization, addressed to an address nobody owns,
 * with a token this test knows the plaintext of.
 *
 * 🔴 Created here and hard-deleted afterwards. These suites run against the dev
 * database in parallel, so mutating a row this test merely *found* would break
 * whatever another suite is doing with it.
 */
async function makeInvitation() {
  const org = await prisma.organization.findFirst({
    where: { isDeleted: false },
    select: { id: true },
  });
  if (!org) throw new Error('no organization in the dev database to invite into');

  // permission_templates is RLS-gated, so it is only readable inside a tenant
  // context; organizations and invitations carry no policy on purpose.
  const template = await runAsTenant(org.id, (tx) =>
    tx.permissionTemplate.findFirst({
      where: { organizationId: org.id, isDeleted: false },
      select: { id: true },
    }),
  );
  if (!template) throw new Error('no permission template to attach the invitation to');

  const unique = process.hrtime.bigint().toString(36);

  const inviter = await prisma.user.create({
    data: {
      email: `invite-sso-inviter-${unique}@example.invalid`,
      firstName: 'Invite',
      lastName: 'Probe',
      fullName: 'Invite Probe',
      userAgent: 'unknown',
    },
    select: { id: true },
  });
  users.push(inviter.id);

  const rawToken = randomUUID();
  const email = `invite-sso-${unique}@example.invalid`;

  const invitation = await prisma.invitation.create({
    data: {
      organizationId: org.id,
      email,
      tokenHash: createHash('sha256').update(rawToken).digest('hex'),
      status: 'pending',
      invitedById: inviter.id,
      permissionTemplateId: template.id,
      expiresAt: new Date(Date.now() + 7 * 864e5),
    },
    select: { id: true, email: true },
  });
  invitationIds.push(invitation.id);

  return { rawToken, email: invitation.email, id: invitation.id };
}

afterAll(async () => {
  // Invitations first — they reference the inviter through `invited_by_id`.
  await prisma.invitation.deleteMany({ where: { id: { in: invitationIds } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});

describe('invitation accept — no local password once SSO is on', () => {
  it('refuses an anonymous accept and creates NO account', async () => {
    const invite = await makeInvitation();

    await expect(
      acceptInvitation(
        invite.rawToken,
        null, // anonymous — nobody is signed in
        { firstName: 'Walk', lastName: 'In', password: 'Sup3rSecret!invite' },
        'vitest',
      ),
    ).rejects.toMatchObject({ status: 401, details: { code: 'SIGN_IN_REQUIRED' } });

    // The assertion that actually matters. The refusal above could be reversed and
    // this is what would tell you what it cost: an account with a credential the
    // identity provider never issued and cannot revoke.
    expect(
      await prisma.user.count({ where: { email: invite.email } }),
      'anonymous accept must not create a local user while SSO is on',
    ).toBe(0);
  });

  it('does not leak whether the invited address is registered', async () => {
    const invite = await makeInvitation();

    // Give the address an account, then accept anonymously again. Before the guard
    // this answered 409 ACCOUNT_EXISTS here and 400 for an unknown address, which
    // turned a public endpoint into a way to test whether someone has an account.
    const existing = await prisma.user.create({
      data: {
        email: invite.email,
        firstName: 'Already',
        lastName: 'Here',
        fullName: 'Already Here',
        userAgent: 'unknown',
      },
      select: { id: true },
    });
    users.push(existing.id);

    await expect(acceptInvitation(invite.rawToken, null, {}, 'vitest')).rejects.toMatchObject({
      status: 401,
      details: { code: 'SIGN_IN_REQUIRED' },
    });
  });

  it('still refuses when no password is offered at all', async () => {
    const invite = await makeInvitation();

    // The guard must sit ABOVE the "enter your name and a password" branch, or the
    // refusal depends on what the caller happened to send.
    await expect(acceptInvitation(invite.rawToken, null, {}, 'vitest')).rejects.toMatchObject({
      status: 401,
    });

    expect(await prisma.user.count({ where: { email: invite.email } })).toBe(0);
  });
});
