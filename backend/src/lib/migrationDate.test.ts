import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../db/testTenant.ts';
import {
  assertMigrationDateSettable,
  assertOnOrAfterMigration,
  getMigrationDate,
  restampOpeningStock,
} from './migrationDate.ts';
import { ApiError } from './apiError.ts';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
} from '../modules/settings/organization/organizations/organizations.schemas.ts';

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

/** A third org with real fixtures, for the two functions that read the ledger. */
let ledgerOrgId: string;
let ledgerItemId: string;
let ledgerBatchId: string;
let ledgerLocationId: string;

const unique = () => process.hrtime.bigint().toString(36);

beforeAll(async () => {
  anchoredOrgId = await createTestOrganization('migration-date-anchored');
  unanchoredOrgId = await createTestOrganization('migration-date-none');
  ledgerOrgId = await createTestOrganization('migration-date-ledger');

  await prisma.organization.update({
    where: { id: anchoredOrgId },
    data: { migrationDate: ANCHOR },
  });

  await runAsTenant(ledgerOrgId, async (tx) => {
    const uom = await tx.unitOfMeasurement.create({
      data: { organizationId: ledgerOrgId, unitName: 'Metre', symbol: 'MTR' },
      select: { id: true },
    });
    const item = await tx.item.create({
      data: {
        organizationId: ledgerOrgId,
        name: 'Grey Fabric',
        sku: `MIGDATE-${unique()}`,
        unit: 'Metre',
        stockingUomId: uom.id,
        trackInventory: true,
        inventoryTracking: 'batch',
      },
      select: { id: true },
    });
    ledgerItemId = item.id;

    const location = await tx.location.create({
      data: { organizationId: ledgerOrgId, name: 'Main Godown', type: 'godown' },
      select: { id: true },
    });
    ledgerLocationId = location.id;

    const batch = await tx.batch.create({
      data: {
        organizationId: ledgerOrgId,
        itemId: item.id,
        batchNumber: `B-${unique()}`,
        uomId: uom.id,
      },
      select: { id: true },
    });
    ledgerBatchId = batch.id;
  });
});

afterAll(async () => {
  await runAsTenant(ledgerOrgId, async (tx) => {
    await tx.stockLedgerEntry.deleteMany({ where: { organizationId: ledgerOrgId } });
    await tx.batch.deleteMany({ where: { organizationId: ledgerOrgId } });
    await tx.item.deleteMany({ where: { organizationId: ledgerOrgId } });
    await tx.location.deleteMany({ where: { organizationId: ledgerOrgId } });
    await tx.unitOfMeasurement.deleteMany({ where: { organizationId: ledgerOrgId } });
  });
  await deleteTestOrganization(anchoredOrgId);
  await deleteTestOrganization(unanchoredOrgId);
  await deleteTestOrganization(ledgerOrgId);
});

/** One ledger row on the fixture org, dated where the test needs it. */
async function postRow(args: {
  sourceDocType: string;
  movementType: string;
  postedAt: Date;
  qtyIn?: number;
}) {
  return runAsTenant(ledgerOrgId, (tx) =>
    tx.stockLedgerEntry.create({
      data: {
        organizationId: ledgerOrgId,
        itemId: ledgerItemId,
        batchId: ledgerBatchId,
        locationId: ledgerLocationId,
        movementType: args.movementType,
        qtyIn: args.qtyIn ?? 10,
        sourceDocType: args.sourceDocType,
        postedAt: args.postedAt,
      },
      select: { id: true },
    }),
  );
}

/** Clear the fixture org's ledger between cases — each one owns its own rows. */
const clearLedger = () =>
  runAsTenant(ledgerOrgId, (tx) =>
    tx.stockLedgerEntry.deleteMany({ where: { organizationId: ledgerOrgId } }),
  );

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

/**
 * 🔴 THE FIELD IN SETTINGS → PREFERENCES WRITES THROUGH THESE TWO.
 *
 * Saving a migration date is not one write. It has to refuse a day that would
 * leave existing movements behind it — the anchor's whole meaning is that
 * nothing is dated before it — and it has to carry the opening stock along, or
 * the organization asserts two dates at once and the balance as at its own
 * anchor reads zero. Both run inside the update endpoint's transaction.
 */
describe('migration date — setting it from Preferences', () => {
  const APRIL = new Date('2026-04-01T00:00:00.000Z');

  it('allows any day on an organization with no movements at all', async () => {
    await clearLedger();
    await expect(
      runAsTenant(ledgerOrgId, (tx) =>
        assertMigrationDateSettable(tx, { organizationId: ledgerOrgId, date: APRIL }),
      ),
    ).resolves.toBeUndefined();
  });

  /**
   * 🔴 AN ESTABLISHED BUSINESS CAN STILL ADOPT ONE. The test is "would anything
   * fall behind this day", NOT "has this organization been used" — a stricter
   * rule reads as tidier and leaves every existing customer unable to set an
   * anchor at all.
   */
  it('allows a day on or before the earliest movement', async () => {
    await clearLedger();
    await postRow({
      sourceDocType: 'bill',
      movementType: 'receipt',
      postedAt: new Date('2026-05-10T00:00:00.000Z'),
    });

    await expect(
      runAsTenant(ledgerOrgId, (tx) =>
        assertMigrationDateSettable(tx, { organizationId: ledgerOrgId, date: APRIL }),
      ),
    ).resolves.toBeUndefined();
  });

  it('refuses a day with movements behind it, and names the earliest', async () => {
    await clearLedger();
    await postRow({
      sourceDocType: 'job_issue',
      movementType: 'issue',
      postedAt: new Date('2026-02-20T00:00:00.000Z'),
    });

    const error = await runAsTenant(ledgerOrgId, (tx) =>
      assertMigrationDateSettable(tx, { organizationId: ledgerOrgId, date: APRIL }),
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    const api = error as ApiError;
    expect(api.status).toBe(400);
    // The message has to say what to pick instead, or the user is left guessing
    // at a date the form will accept.
    expect(String((api.details as Record<string, string>)['migrationDate'])).toContain(
      '20-02-2026',
    );
  });

  /**
   * 🔴 OPENING STOCK IS NOT A CONSTRAINT ON THE ANCHOR — it is what the anchor
   * DATES. Counting it here would make an organization that has already declared
   * opening stock unable to move its own migration date, which is exactly the
   * state OCTFIS TECHNO LLP was in.
   */
  it('ignores opening stock when deciding, however it is dated', async () => {
    await clearLedger();
    await postRow({
      sourceDocType: 'item_opening_stock',
      movementType: 'opening',
      postedAt: new Date('2026-01-05T00:00:00.000Z'),
    });

    await expect(
      runAsTenant(ledgerOrgId, (tx) =>
        assertMigrationDateSettable(tx, { organizationId: ledgerOrgId, date: APRIL }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('migration date — re-stamping the opening stock', () => {
  const JUNE = new Date('2026-06-09T00:00:00.000Z');

  it('moves the declaration AND its corrections, and nothing else', async () => {
    await clearLedger();
    const typedOn = new Date('2026-08-11T00:00:00.000Z');

    await postRow({
      sourceDocType: 'item_opening_stock',
      movementType: 'opening',
      postedAt: typedOn,
    });
    // 🔴 `settleOpening` writes a correction to an opening figure as a `reversal`
    // against the same document. Moving the declaration without its corrections
    // leaves the anchor's balance overstated by every fix ever made to it.
    await postRow({
      sourceDocType: 'item_opening_stock',
      movementType: 'reversal',
      postedAt: typedOn,
    });
    // A real event, on its own day. It must not move.
    await postRow({
      sourceDocType: 'bill',
      movementType: 'receipt',
      postedAt: typedOn,
    });

    const moved = await runAsTenant(ledgerOrgId, (tx) =>
      restampOpeningStock(tx, { organizationId: ledgerOrgId, date: JUNE }),
    );
    expect(moved).toBe(2);

    const rows = await runAsTenant(ledgerOrgId, (tx) =>
      tx.stockLedgerEntry.findMany({
        where: { organizationId: ledgerOrgId },
        select: { sourceDocType: true, postedAt: true },
      }),
    );

    for (const row of rows) {
      const expected = row.sourceDocType === 'item_opening_stock' ? JUNE : typedOn;
      expect(row.postedAt.toISOString()).toBe(expected.toISOString());
    }
  });
});

/**
 * 🔴 THE WIRE FORMAT THE PREFERENCES FIELD POSTS. `<input type="date">` yields
 * `YYYY-MM-DD`, and the schema takes that and nothing looser — an instant would
 * land the anchor on the previous UTC day for an IST user, which is the whole
 * reason `migrationDate.ts` insists on a calendar day.
 */
describe('migration date — what the update endpoint accepts', () => {
  it('takes the date-only string the field produces', () => {
    const parsed = updateOrganizationSchema.safeParse({ migrationDate: '2026-04-01' });
    expect(parsed.success).toBe(true);
  });

  /** Clearing the field is how an organization goes back to "never migrated". */
  it('takes an empty string, to clear the anchor', () => {
    expect(updateOrganizationSchema.safeParse({ migrationDate: '' }).success).toBe(true);
    expect(updateOrganizationSchema.safeParse({ migrationDate: null }).success).toBe(true);
  });

  it('refuses a display-formatted date and a full instant', () => {
    expect(updateOrganizationSchema.safeParse({ migrationDate: '01-04-2026' }).success).toBe(false);
    expect(
      updateOrganizationSchema.safeParse({ migrationDate: '2026-04-01T00:00:00+05:30' }).success,
    ).toBe(false);
  });

  /** Every other Preferences field still saves on its own, as it always did. */
  it('leaves the rest of the form alone when the anchor is not sent', () => {
    const parsed = updateOrganizationSchema.safeParse({
      settings: { itemTrackingLabel: { singular: 'Lot', plural: 'Lots' } },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.migrationDate).toBeUndefined();
  });

  /**
   * 🔴 UPDATE-ONLY, AND THE CREATE SCHEMA MUST NOT CARRY IT.
   *
   * It was on the create schema until this test existed, while
   * `createOrganization` never wrote it — a field the API validated, accepted
   * and then silently discarded. Zoho Books asks for the migration date on
   * Settings → Opening Balances rather than when an organization is made, and
   * nothing here depends on it until opening stock is declared.
   *
   * This asserts the CONTRACT, not the storage: the key is not part of what
   * creating an organization means, so it does not survive parsing and cannot be
   * mistaken for something that was saved.
   */
  it('is not part of creating an organization', () => {
    const parsed = createOrganizationSchema.safeParse({
      name: 'Acme Corp',
      industryType: 'technology',
      migrationDate: '2026-04-01',
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && 'migrationDate' in parsed.data).toBe(false);
  });
});
