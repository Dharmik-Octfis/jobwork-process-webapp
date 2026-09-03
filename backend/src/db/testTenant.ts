import { prisma } from './prisma.ts';

/**
 * 🔴 TEST FIXTURE PLUMBING — the two things every suite that mints its own
 * organization has to get right, in one place.
 *
 * Suites run against the SHARED DEV DATABASE, in parallel. That makes two
 * mistakes possible that nothing else in the codebase can make.
 *
 * 1. A COLLIDING `orgCode`. Every suite used `String(Date.now()).slice(-10)`,
 *    which is the same value for any two suites starting in the same
 *    millisecond — and `beforeAll` then throws on the unique index. That is not
 *    a flake to retry past; see (2) for what happens next.
 *
 * 2. 🔴 AN UNSET `orgId` REACHING `deleteMany`. When `beforeAll` fails, the
 *    module-level `orgId` stays `undefined`, and Prisma reads
 *    `where: { id: undefined }` as NO FILTER — so a cleanup written to remove one
 *    organization becomes `deleteMany()` over the whole table. `organizations`
 *    is deliberately the ONE table with no RLS policy (`tenantContext` reads it
 *    before a tenant exists), so nothing underneath would have stopped it.
 *
 *    On 2026-09-02 this fired for real: a colliding `orgCode` failed a
 *    `beforeAll`, and the `afterAll` behind it attempted exactly that delete. It
 *    was stopped by an unrelated `RESTRICT` foreign key from `purchase_order_items`
 *    — luck, not design. Nothing was lost, and the trigger is now removed rather
 *    than left armed.
 */

/** A per-process counter, so two organizations minted in one nanosecond differ. */
let seq = 0;

/**
 * Ten digits like the real generator, but drawn from the high-resolution clock
 * plus a counter rather than from `Date.now()` — which is the same value for any
 * two suites that start in the same millisecond.
 */
export function uniqueOrgCode(): string {
  return `${process.hrtime.bigint()}${seq++}`.slice(-10);
}

/** Create a test organization with an `orgCode` that cannot collide. */
export async function createTestOrganization(namePrefix: string): Promise<string> {
  const org = await prisma.organization.create({
    data: {
      name: `${namePrefix}-${process.hrtime.bigint().toString(36)}`,
      orgCode: uniqueOrgCode(),
    },
    select: { id: true },
  });
  return org.id;
}

/**
 * Hard-delete a test organization — and REFUSE to do anything at all when the id
 * is missing.
 *
 * 🔴 The guard is the entire point. `deleteMany({ where: { id: undefined } })`
 * deletes every row; this turns that into a no-op with a loud reason, which is
 * what an `afterAll` running behind a failed `beforeAll` needs.
 */
export async function deleteTestOrganization(orgId: string | undefined): Promise<void> {
  if (!orgId) {
     
    console.warn(
      'deleteTestOrganization: no organization id — setup must have failed. Skipping cleanup ' +
        'rather than issuing an unfiltered delete.',
    );
    return;
  }
  await prisma.organization.deleteMany({ where: { id: orgId } });
}
