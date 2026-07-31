import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '../../../../db/prisma.ts';
import {
  clearMemberDirectoryL1,
  composeFullName,
  getMemberDirectory,
  invalidateMemberDirectory,
} from '../../../../lib/memberDirectory.ts';
import { getMember, updateMember, updateMyProfile } from './members.service.ts';

/**
 * The invariants that make per-org member profiles work, and that nothing else
 * would notice breaking.
 *
 * ONE ACCOUNT, TWO ORGANIZATIONS, TWO NAMES. That is the whole feature. If the
 * first describe block goes red, editing somebody in one org has started leaking
 * into another org — or into their account name, which every invitation email and
 * the org picker read. Both are silent: the API keeps returning 200 and the wrong
 * name simply appears somewhere nobody was looking.
 *
 * The second block pins the createdBy/updatedBy resolution ladder, including the
 * two cases that are easy to get wrong in the "helpful" direction: a former member
 * must still resolve (not read "Support"), and an actor who was never a member here
 * must NOT fall back to their account name — that would surface a support
 * engineer's real name inside a customer's tenant.
 *
 * 🔴 Every row here is created by this file and hard-deleted afterwards. These
 * suites run against the dev database *in parallel*, so mutating a user or
 * membership this file merely *found* would break whatever another suite is doing
 * with it at that moment.
 */

const unique = process.hrtime.bigint().toString(36);

let userId = '';
let outsiderId = '';
let orgAId = '';
let orgBId = '';
let membershipAId = '';
let membershipBId = '';
let adminId = '';
let adminMembershipAId = '';

/** A bare organization. No seeding: these tests never touch roles or templates, and
 * `updateMember` only validates those when the input mentions them. */
async function makeOrg(name: string): Promise<string> {
  const org = await prisma.organization.create({
    data: { name, orgCode: `${Date.now()}${Math.trunc(performance.now())}`.slice(-10) },
    select: { id: true },
  });
  return org.id;
}

async function makeUser(label: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `member-profile-${label}-${unique}@example.invalid`,
      // The ACCOUNT name. Deliberately distinct from every membership name below, so
      // a test that accidentally reads the account name fails loudly.
      firstName: 'Account',
      lastName: 'Name',
      fullName: 'Account Name',
      userAgent: 'unknown',
    },
    select: { id: true },
  });
  return user.id;
}

async function makeMembership(
  uid: string,
  orgId: string,
  firstName: string,
  lastName: string,
  extra: { isOwner?: boolean; createdBy?: string } = {},
): Promise<string> {
  const m = await prisma.membership.create({
    data: {
      userId: uid,
      organizationId: orgId,
      firstName,
      lastName,
      fullName: composeFullName(firstName, lastName),
      ...extra,
    },
    select: { id: true },
  });
  return m.id;
}

beforeAll(async () => {
  orgAId = await makeOrg(`Per-org A ${unique}`);
  orgBId = await makeOrg(`Per-org B ${unique}`);

  userId = await makeUser('subject');
  adminId = await makeUser('admin');
  outsiderId = await makeUser('outsider');

  // The same person, in two organizations, under two different names.
  membershipAId = await makeMembership(userId, orgAId, 'Priya', 'Shah', { createdBy: adminId });
  membershipBId = await makeMembership(userId, orgBId, 'P', 'S');

  // Someone to act as the editing admin in org A.
  adminMembershipAId = await makeMembership(adminId, orgAId, 'Asha', 'Admin');

  clearMemberDirectoryL1();
});

afterAll(async () => {
  // Hard deletes, children first. Memberships cascade from both user and org, but
  // deleting them explicitly keeps the order obvious if either parent delete fails.
  await prisma.membership.deleteMany({
    where: { id: { in: [membershipAId, membershipBId, adminMembershipAId].filter(Boolean) } },
  });
  await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId].filter(Boolean) } } });
  await prisma.user.deleteMany({
    where: { id: { in: [userId, adminId, outsiderId].filter(Boolean) } },
  });
  clearMemberDirectoryL1();
});

describe('a member profile belongs to one organization', () => {
  it('the same account carries a different name in each organization', async () => {
    const [a, b, account] = await Promise.all([
      prisma.membership.findUnique({ where: { id: membershipAId }, select: { fullName: true } }),
      prisma.membership.findUnique({ where: { id: membershipBId }, select: { fullName: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
    ]);

    expect(a?.fullName).toBe('Priya Shah');
    expect(b?.fullName).toBe('P S');
    // The account name is a third, independent value — not a copy of either.
    expect(account?.fullName).toBe('Account Name');
  });

  it('an admin renaming someone in org A changes neither org B nor the account', async () => {
    await updateMember(adminId, orgAId, membershipAId, {
      firstName: 'Priyanka',
      lastName: 'Shah-Patel',
    });

    const [a, b, account] = await Promise.all([
      prisma.membership.findUnique({ where: { id: membershipAId }, select: { fullName: true } }),
      prisma.membership.findUnique({ where: { id: membershipBId }, select: { fullName: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
    ]);

    expect(a?.fullName).toBe('Priyanka Shah-Patel');
    // 🔴 The two assertions this whole feature exists for.
    expect(b?.fullName, 'renaming in org A leaked into org B').toBe('P S');
    expect(account?.fullName, 'renaming in org A leaked into the account').toBe('Account Name');
  });

  it('a member renaming themselves changes only that org, not the account', async () => {
    await updateMyProfile(userId, orgBId, { firstName: 'Pri', lastName: 'Shah' });

    const [a, b, account] = await Promise.all([
      prisma.membership.findUnique({ where: { id: membershipAId }, select: { fullName: true } }),
      prisma.membership.findUnique({ where: { id: membershipBId }, select: { fullName: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
    ]);

    expect(b?.fullName).toBe('Pri Shah');
    expect(a?.fullName, 'self-rename in org B leaked into org A').toBe('Priyanka Shah-Patel');
    expect(account?.fullName, 'self-rename leaked into the account').toBe('Account Name');
  });

  it('keeps the derived fullName in step with its parts', async () => {
    // `fullName` is denormalized, so a partial update that touched only one part
    // could leave it stale — which is exactly what nobody would notice.
    await updateMember(adminId, orgAId, membershipAId, { lastName: 'Mehta' });

    const row = await prisma.membership.findUnique({
      where: { id: membershipAId },
      select: { firstName: true, lastName: true, fullName: true },
    });

    expect(row?.firstName).toBe('Priyanka');
    expect(row?.lastName).toBe('Mehta');
    expect(row?.fullName).toBe('Priyanka Mehta');
  });

  it('shares phone and address across organizations — they live on the account', async () => {
    // The counterpart to the three tests above, and the reason they are worth
    // stating separately: the NAME is per-org, everything else is not. If this ever
    // goes red because someone moved these columns back onto `memberships`, two orgs
    // can hold contradictory phone numbers for one person with no way to say which
    // is current.
    await updateMember(adminId, orgAId, membershipAId, {
      phone: '+91 98250 11111',
      addressLine1: '12 Kalawad Road',
      zip: '360005',
    });

    const [inOrgA, inOrgB, account] = await Promise.all([
      getMember(orgAId, membershipAId),
      getMember(orgBId, membershipBId),
      prisma.user.findUnique({ where: { id: userId }, select: { phone: true } }),
    ]);

    expect(inOrgA.phone).toBe('+91 98250 11111');
    // 🔴 Set in org A, visible in org B. Deliberate.
    expect(inOrgB.phone, 'account details are not reaching the other organization').toBe(
      '+91 98250 11111',
    );
    expect(inOrgB.address.line1).toBe('12 Kalawad Road');
    expect(account?.phone).toBe('+91 98250 11111');

    // …while the names stay independent, which is the whole point of the split.
    expect(inOrgA.fullName).not.toBe(inOrgB.fullName);
  });

  it('never writes the account name when a per-org name changes', async () => {
    // `accountDetailData` deliberately omits firstName/lastName/fullName. If that
    // slips, invitation emails and the org picker start showing whatever the last
    // admin typed in whichever org they happened to be in.
    await updateMember(adminId, orgAId, membershipAId, { firstName: 'Renamed' });

    const account = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, fullName: true },
    });

    expect(account?.firstName).toBe('Account');
    expect(account?.fullName).toBe('Account Name');
  });

  it('refuses to let an admin edit their own role or access through the admin route', async () => {
    // The route requires `member:update`, so allowing it to address the caller would
    // be a self-promotion for anyone holding that permission.
    await expect(
      updateMember(adminId, orgAId, adminMembershipAId, { firstName: 'Nope' }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('createdBy / updatedBy resolve to a name in the acting organization', () => {
  it('resolves a current member to their name in THIS org', async () => {
    await invalidateMemberDirectory(orgAId);
    const dirA = await getMemberDirectory(orgAId);
    const dirB = await getMemberDirectory(orgBId);

    // Same user id, two organizations, two answers.
    expect(dirA.actorName(userId)).toBe('Priyanka Mehta');
    expect(dirB.actorName(userId)).toBe('Pri Shah');
  });

  it('renders "System" when no actor was recorded', async () => {
    const dir = await getMemberDirectory(orgAId);
    // Migrations, seed.ts and self-signup all leave createdBy null, as does a
    // deleted user row (the audit FKs are onDelete: SetNull).
    expect(dir.actorName(null)).toBe('System');
    expect(dir.actorName(undefined)).toBe('System');
  });

  it('renders "Support" for an actor who is not a member here — never their account name', async () => {
    const dir = await getMemberDirectory(orgAId);

    // 🔴 The tempting bug is falling back to `users.fullName`, which would print a
    // support engineer's real name inside a customer's organization.
    expect(dir.actorName(outsiderId)).toBe('Support');
    expect(dir.actorName(outsiderId)).not.toContain('Account');
  });

  it('still resolves a FORMER member, so their past work keeps their name', async () => {
    // Removal is a soft delete. The directory deliberately does not filter
    // `isDeleted`, because otherwise every row a departed colleague created would
    // read "Support" — which looks like data corruption rather than a departure.
    await prisma.membership.update({
      where: { id: membershipAId },
      data: { isDeleted: true, isActive: false },
    });
    await invalidateMemberDirectory(orgAId);

    const dir = await getMemberDirectory(orgAId);
    expect(dir.actorName(userId)).toBe('Priyanka Mehta');

    // Put it back so ordering between these tests cannot matter.
    await prisma.membership.update({
      where: { id: membershipAId },
      data: { isDeleted: false, isActive: true },
    });
    await invalidateMemberDirectory(orgAId);
  });

  it('scopes the directory to one organization', async () => {
    const dirB = await getMemberDirectory(orgBId);
    // The admin is a member of org A only. Org B must not see them at all — this is
    // the assertion that fails if the `organizationId` filter is ever dropped, and
    // there is no RLS policy on `memberships` to catch it.
    expect(dirB.nameFor(adminId)).toBeNull();
    expect(dirB.actorName(adminId)).toBe('Support');
  });
});
