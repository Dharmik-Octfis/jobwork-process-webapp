import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../db/testTenant.ts';
import { assertOnOrAfterMigration, getMigrationDate } from './migrationDate.ts';
import { ApiError } from './apiError.ts';

/**
 * 🔴 THE GUARD IS THE WHOLE FEATURE, so it is pinned here.
 *
 * The migration date is enforced on the WRITE path and nowhere else — no read
 * query filters on it, because after this guard there is no row before the
 * anchor to filter. That makes this function the single thing standing between
 * the ledger and a document filed behind the day the books began, and a service
 * that forgets to call it fails OPEN and silently.
 *
 * 🔴 Both organizations are created here and hard-deleted afterwards — suites
 * run against the dev database IN PARALLEL.
 */

/** The anchor every case below is measured against. */
const ANCHOR = new Date('2026-04-01T00:00:00.000Z');

let anchoredOrgId: string;
let unanchoredOrgId: string;

beforeAll(async () => {
  anchoredOrgId = await createTestOrganization('migration-date-anchored');
  unanchoredOrgId = await createTestOrganization('migration-date-none');

  await prisma.organization.update({
    where: { id: anchoredOrgId },
    data: { migrationDate: ANCHOR },
  });
});

afterAll(async () => {
  await deleteTestOrganization(anchoredOrgId);
  await deleteTestOrganization(unanchoredOrgId);
});

/** `assertOnOrAfterMigration` against the anchored org, with a challan's shape. */
const check = (orgId: string, date: Date) =>
  runAsTenant(orgId, (tx) =>
    assertOnOrAfterMigration(tx, {
      organizationId: orgId,
      date,
      field: 'issueDate',
      label: 'challan',
    }),
  );

describe('migration date — reading the anchor', () => {
  it('reads back the day the books begin', async () => {
    const value = await runAsTenant(anchoredOrgId, (tx) => getMigrationDate(tx, anchoredOrgId));
    expect(value?.toISOString()).toBe(ANCHOR.toISOString());
  });

  it('is null for an organization that never migrated', async () => {
    const value = await runAsTenant(unanchoredOrgId, (tx) => getMigrationDate(tx, unanchoredOrgId));
    expect(value).toBeNull();
  });
});

describe('migration date — the guard', () => {
  /**
   * 🔴 NULL MEANS NO GUARD, and this is what keeps every organization that
   * predates the column working exactly as it did. If this ever starts throwing,
   * adding the column retroactively invented an anchor for businesses that never
   * set one and began refusing their entries on deploy.
   */
  it('allows anything when the organization has no anchor', async () => {
    await expect(
      check(unanchoredOrgId, new Date('2019-01-01T00:00:00.000Z')),
    ).resolves.toBeUndefined();
  });

  it('allows a date after the anchor', async () => {
    await expect(
      check(anchoredOrgId, new Date('2026-04-02T00:00:00.000Z')),
    ).resolves.toBeUndefined();
  });

  /**
   * 🔴 THE BOUNDARY, and the one most likely to be broken by a refactor. The
   * anchor is the FIRST day of the books, not the day before them — a challan
   * dated on it is the earliest legal document, and rejecting it makes day one
   * of every migration unusable.
   */
  it('allows a date ON the anchor', async () => {
    await expect(check(anchoredOrgId, ANCHOR)).resolves.toBeUndefined();
  });

  /**
   * 🔴 THE WIRE FORMAT, pinned as the contract it is. Every form sends a
   * DATE-ONLY string — `.slice(0, 10)` in `IssueForm`, `.split('T')[0]` in
   * `CreateBill` — and `z.coerce.date()` parses that as UTC midnight, which is
   * what makes the anchor comparison safe without a per-org timezone to
   * arbitrate with. This asserts the exact coercion the schemas perform.
   */
  it('allows the anchor day as the date-only string every form sends', async () => {
    await expect(check(anchoredOrgId, new Date('2026-04-01'))).resolves.toBeUndefined();
  });

  /**
   * 🔴 AND THE OTHER HALF OF THAT CONTRACT — what breaks if a form stops
   * honouring it. `2026-04-01T00:00:00+05:30` is what a naive `toISOString()` on
   * a local Date produces in IST: the same calendar day to the user, six hours
   * into the PREVIOUS day in UTC. It is refused, so the first day of the books
   * would become unusable for every Indian user while passing in UTC — a bug
   * that appears only in production.
   *
   * This test failing is not a reason to loosen the guard. It means a date input
   * started sending an instant instead of a day: fix the form, or give
   * organizations a real timezone and compare in it.
   */
  it('refuses the anchor day sent as an offset-bearing ISO — the wire format must stay date-only', async () => {
    await expect(check(anchoredOrgId, new Date('2026-04-01T00:00:00+05:30'))).rejects.toThrow(
      ApiError,
    );
  });

  it('refuses the day before the anchor', async () => {
    await expect(check(anchoredOrgId, new Date('2026-03-31T00:00:00.000Z'))).rejects.toThrow(
      ApiError,
    );
  });

  /**
   * The rejection has to land on the field the user is looking at, or it renders
   * as a banner over a form with nothing highlighted — `details` is what the
   * client reads to mark the input (`response.data.details`, a TOP-LEVEL key).
   */
  it('rejects with a 400 keyed to the field that is wrong', async () => {
    const error = await check(anchoredOrgId, new Date('2026-03-01T00:00:00.000Z')).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(ApiError);
    const api = error as ApiError;
    expect(api.status).toBe(400);
    expect(api.details).toHaveProperty('issueDate');
    // …and it names the day, so the user knows what to change it to. Formatted
    // the way the Zoho screen this mirrors shows it, and the way India reads it.
    expect(String((api.details as Record<string, string>)['issueDate'])).toContain('01-04-2026');
  });

  it('keys the message to whichever document is being saved', async () => {
    const error = await runAsTenant(anchoredOrgId, (tx) =>
      assertOnOrAfterMigration(tx, {
        organizationId: anchoredOrgId,
        date: new Date('2026-03-01T00:00:00.000Z'),
        field: 'billDate',
        label: 'bill',
      }),
    ).catch((err: unknown) => err);

    const api = error as ApiError;
    expect(api.details).toHaveProperty('billDate');
    expect(api.message).toContain('bill');
  });
});
