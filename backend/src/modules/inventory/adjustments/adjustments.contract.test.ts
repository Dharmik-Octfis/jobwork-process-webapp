import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../../../db/testTenant.ts';
import { seedTestReasons } from './adjustmentReasons.testing.ts';
import { createBatch, postMovement } from '../stock-ledger/stockLedger.service.ts';
import { adjustmentsService } from './adjustments.service.ts';

/**
 * 🔴 THE SHAPE THE SCREENS PARSE. The web client runs every response through its
 * own zod schema and throws on a mismatch — which shows up as a blank screen,
 * not as a failing typecheck, because the two sides share no types. This parses
 * what the service really returns (after a JSON round trip, as HTTP does) with
 * the client's own schemas, for a draft and for a posted adjustment.
 */

const unique = () => process.hrtime.bigint().toString(36);
const overHttp = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

/** As much of the client's parsed shape as this file asserts on. */
interface ParsedLine {
  draftBatches: unknown;
  item: { stockingUom?: { symbol: string } | null };
  batches: { batch: { supplierBatchRef: string | null } }[];
}
interface ParsedDetail {
  status: string;
  deleted?: boolean;
  lines: ParsedLine[];
  draftLabels: { batches: Record<string, string> };
}
interface ClientSchemas {
  stockAdjustmentDetailSchema: { parse: (value: unknown) => ParsedDetail };
  stockAdjustmentRowSchema: { parse: (value: unknown) => { lines: unknown[] } };
}

/**
 * Loaded by URL at run time rather than imported: the web app is outside this
 * package's `rootDir`, so a static import would fail the backend typecheck.
 */
const CLIENT_SCHEMAS = new URL(
  '../../../../../web/src/features/inventory/adjustments/adjustments.schemas.ts',
  import.meta.url,
).href;
let client: ClientSchemas;

let orgId: string;
let userId: string;
let godownId: string;
let trackedId: string;
let plainId: string;
let existingBatchId: string;

let reasons: Awaited<ReturnType<typeof seedTestReasons>>;

beforeAll(async () => {
  client = (await import(CLIENT_SCHEMAS)) as ClientSchemas;
  orgId = await createTestOrganization('stock-adjustment-contract');
  reasons = await seedTestReasons(orgId);
  userId = (
    await prisma.user.create({
      data: {
        email: `adj-contract-${unique()}@example.test`,
        passwordHash: 'x',
        firstName: 'Adj',
        fullName: 'Adjustment Contract',
      },
      select: { id: true },
    })
  ).id;

  await runAsTenant(orgId, async (tx) => {
    const uom = await tx.unitOfMeasurement.create({
      data: { organizationId: orgId, unitName: 'Metre', symbol: 'MTR' },
      select: { id: true },
    });
    godownId = (
      await tx.location.create({
        data: { organizationId: orgId, name: 'Main Godown', type: 'godown' },
        select: { id: true },
      })
    ).id;
    const make = (tracking: string) =>
      tx.item.create({
        data: {
          organizationId: orgId,
          name: `Adj contract ${tracking} ${unique()}`,
          sku: `ADJC-${unique()}`,
          unit: 'Metre',
          stockingUomId: uom.id,
          itemType: 'goods',
          trackInventory: true,
          inventoryTracking: tracking,
          costPrice: 12.5,
        },
        select: { id: true },
      });
    trackedId = (await make('batch')).id;
    plainId = (await make('none')).id;

    const batch = await createBatch(tx, {
      organizationId: orgId,
      itemId: trackedId,
      supplierBatchRef: `SEED-${unique()}`,
      sourceDocType: 'test',
    });
    await postMovement(tx, {
      organizationId: orgId,
      batchId: batch.id,
      locationId: godownId,
      movementType: 'receipt',
      qtyIn: 10,
      valueIn: 100,
      sourceDocType: 'test',
    });
    existingBatchId = batch.id;
  });
}, 60_000);

afterAll(async () => {
  if (orgId) {
    await runAsTenant(orgId, async (tx) => {
      await tx.stockAdjustmentBatch.deleteMany({ where: { organizationId: orgId } });
      await tx.stockAdjustmentLine.deleteMany({ where: { organizationId: orgId } });
      await tx.stockAdjustment.deleteMany({ where: { organizationId: orgId } });
      await tx.stockLedgerEntry.deleteMany({ where: { organizationId: orgId } });
      await tx.batch.deleteMany({ where: { organizationId: orgId } });
      await tx.item.deleteMany({ where: { organizationId: orgId } });
      await tx.location.deleteMany({ where: { organizationId: orgId } });
      await tx.unitOfMeasurement.deleteMany({ where: { organizationId: orgId } });
      await tx.numberSequence.deleteMany({ where: { organizationId: orgId } });
    });
  }
  await deleteTestOrganization(orgId);
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
});

describe('stock adjustments — the shape the screens parse', { timeout: 60_000 }, () => {
  const document = (saveAs: 'draft' | 'adjust') =>
    adjustmentsService.createAdjustment(orgId, userId, {
      locationId: godownId,
      adjustmentDate: '2026-10-02',
      reasonId: reasons['Stock count correction'],
      referenceNumber: 'COUNT-7',
      description: 'Quarter-end count',
      saveAs,
      lines: [
        {
          itemId: trackedId,
          quantityAdjusted: -2,
          batches: [{ batchId: existingBatchId, quantity: 2 }],
        },
        { itemId: plainId, quantityAdjusted: 5, costPrice: 12.5 },
      ],
    });

  it('a draft, a posted adjustment, a removed one and the list all parse', async () => {
    const draft = await document('draft');
    const parsedDraft = client.stockAdjustmentDetailSchema.parse(overHttp(draft));
    expect(parsedDraft.status).toBe('draft');
    // What the edit form is rebuilt from.
    expect(parsedDraft.lines[0]!.draftBatches).toEqual([{ batchId: existingBatchId, quantity: 2 }]);
    expect(parsedDraft.draftLabels.batches[existingBatchId]).toMatch(/^SEED-/);
    expect(parsedDraft.lines[1]!.item.stockingUom?.symbol).toBe('MTR');

    const posted = await document('adjust');
    const parsedPosted = client.stockAdjustmentDetailSchema.parse(overHttp(posted));
    expect(parsedPosted.status).toBe('adjusted');
    expect(parsedPosted.lines[0]!.batches[0]!.batch.supplierBatchRef).toMatch(/^SEED-/);

    const cancelled = await adjustmentsService.removeAdjustment(orgId, posted.id, userId);
    expect(client.stockAdjustmentDetailSchema.parse(overHttp(cancelled)).deleted).toBe(false);
    const deleted = await adjustmentsService.removeAdjustment(orgId, draft.id, userId);
    expect(client.stockAdjustmentDetailSchema.parse(overHttp(deleted)).deleted).toBe(true);

    const list = await adjustmentsService.findManyAdjustments(orgId, {
      page: 1,
      perPage: 25,
    } as Parameters<typeof adjustmentsService.findManyAdjustments>[1]);
    const rows = (overHttp(list) as { results: unknown[] }).results.map((row) =>
      client.stockAdjustmentRowSchema.parse(row),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lines).toHaveLength(2);
  });

  it('a value adjustment — draft, posted with its purchases, cancelled — parses', async () => {
    const value = (saveAs: 'draft' | 'adjust') =>
      adjustmentsService.createAdjustment(orgId, userId, {
        adjustmentType: 'value',
        locationId: godownId,
        adjustmentDate: new Date().toISOString(),
        reasonId: reasons['Write-down to realisable value'],
        saveAs,
        lines: [{ itemId: trackedId, valueAdjusted: -1 }],
      });

    const draft = client.stockAdjustmentDetailSchema.parse(overHttp(await value('draft')));
    expect(draft.status).toBe('draft');

    const posted = await value('adjust');
    const parsed = client.stockAdjustmentDetailSchema.parse(overHttp(posted)) as ParsedDetail & {
      valueChanges: unknown[];
    };
    expect(parsed.status).toBe('adjusted');
    expect(parsed.valueChanges.length).toBeGreaterThan(0);

    const cancelled = await adjustmentsService.removeAdjustment(orgId, posted.id, userId);
    expect(client.stockAdjustmentDetailSchema.parse(overHttp(cancelled)).status).toBe('cancelled');
  });
});
