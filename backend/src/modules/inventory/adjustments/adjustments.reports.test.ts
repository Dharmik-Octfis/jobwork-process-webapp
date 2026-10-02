import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../../../db/testTenant.ts';
import { getItemLedger } from '../../reports/inventory-valuation/inventoryValuation.service.ts';
import { getFifoCostLotTracking } from '../../reports/fifo-cost-lot-tracking/fifoCostLotTracking.service.ts';
import { getStockMovementReport } from '../../reports/stock-movement/stockMovement.service.ts';
import { adjustmentsService } from './adjustments.service.ts';

/**
 * A stock adjustment has to read as one everywhere a ledger row is named — the
 * reports, and the refusal that says which document used the stock. Before these
 * were taught about it, it showed as the raw type or a bare uuid.
 *
 * Own organization, hard-deleted afterwards.
 */

const unique = () => process.hrtime.bigint().toString(36);
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

let orgId: string;
let userId: string;
let itemId: string;
let godownId: string;
let older: Awaited<ReturnType<typeof adjustmentsService.createAdjustment>>;
let newer: typeof older;
let removal: typeof older;

beforeAll(async () => {
  orgId = await createTestOrganization('stock-adjustment-reports');
  userId = (
    await prisma.user.create({
      data: {
        email: `adj-rep-${unique()}@example.test`,
        passwordHash: 'x',
        firstName: 'Adj',
        fullName: 'Adjustment Reports',
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
    itemId = (
      await tx.item.create({
        data: {
          organizationId: orgId,
          name: `Adj report ${unique()}`,
          sku: `ADJR-${unique()}`,
          unit: 'Metre',
          stockingUomId: uom.id,
          itemType: 'goods',
          trackInventory: true,
          inventoryTracking: 'batch',
        },
        select: { id: true },
      })
    ).id;
  });

  const add = (date: string, costPrice: number) =>
    adjustmentsService.createAdjustment(orgId, userId, {
      itemId,
      locationId: godownId,
      adjustmentDate: date,
      quantityAdjusted: 5,
      costPrice,
      reason: 'found',
      batches: [{ supplierBatchRef: `B-${unique()}`, quantity: 5 }],
    });
  older = await add(daysAgo(5), 100);
  newer = await add(daysAgo(1), 120);
  // Out of the NEWER batch — so FIFO pays for it from the OLDER adjustment's layer
  // while that adjustment's own batch stays physically whole.
  removal = await adjustmentsService.createAdjustment(orgId, userId, {
    itemId,
    locationId: godownId,
    adjustmentDate: new Date().toISOString(),
    quantityAdjusted: -2,
    reason: 'damaged',
    batches: [{ batchId: newer.batches[0]!.batchId, quantity: 2 }],
  });
}, 60_000);

afterAll(async () => {
  if (orgId) {
    await runAsTenant(orgId, async (tx) => {
      await tx.stockAdjustmentBatch.deleteMany({ where: { organizationId: orgId } });
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

describe('stock adjustments — as other screens name them', { timeout: 60_000 }, () => {
  it('the item ledger shows each one by name and number, ending at the balance', async () => {
    const ledger = await getItemLedger(orgId, itemId, {});
    const named = ledger.rows.filter((row) => row.sourceDocType === 'inventory_adjustment');

    expect(named.map((row) => row.sourceDocNumber)).toEqual([
      older.adjustmentNumber,
      newer.adjustmentNumber,
      removal.adjustmentNumber,
    ]);
    for (const row of named) expect(row.transactionDetails).toBe('Stock Adjustment');

    const last = ledger.rows[ledger.rows.length - 1]!;
    expect(last.stockOnHand).toBe(8);
    // 5 @ 100 + 5 @ 120, less 2 from the oldest layer.
    expect(last.inventoryAssetValue).toBe(900);
  });

  it('the FIFO cost-lot report names the lot and what drew on it', async () => {
    const report = await getFifoCostLotTracking(orgId, {
      reportBasis: 'product_in',
      page: 1,
      perPage: 25,
    });
    const text = JSON.stringify(report.results);
    expect(text).toContain('Inventory Adjustment By Quantity');
    expect(text).toContain(older.adjustmentNumber);
    expect(text).toContain(removal.adjustmentNumber);
  });

  it('the stock movement report shows the number, not an id', async () => {
    const report = await getStockMovementReport(orgId, {
      itemId,
      movementType: 'all',
      page: 1,
      perPage: 25,
    });
    expect(report.results.map((row) => row.transactionNumber).sort()).toEqual(
      [older.adjustmentNumber, newer.adjustmentNumber, removal.adjustmentNumber].sort(),
    );
  });

  it('a refusal names the adjustment that used the stock', async () => {
    // The older batch still holds its 5, so the quantity guard passes and it is
    // the cost check that refuses — naming the document that drew on the layer.
    await expect(adjustmentsService.cancelAdjustment(orgId, older.id, userId)).rejects.toThrow(
      `stock adjustment ${removal.adjustmentNumber}`,
    );
  });

  it('a cancelled adjustment reads as a cancellation in the item ledger', async () => {
    // Something else in between: the ledger folds a document's consecutive rows
    // together, so a cancel straight after the posting is not a row of its own.
    await adjustmentsService.createAdjustment(orgId, userId, {
      itemId,
      locationId: godownId,
      adjustmentDate: new Date().toISOString(),
      quantityAdjusted: 1,
      costPrice: 50,
      reason: 'found',
      batches: [{ supplierBatchRef: `B-${unique()}`, quantity: 1 }],
    });
    await adjustmentsService.cancelAdjustment(orgId, removal.id, userId);

    const ledger = await getItemLedger(orgId, itemId, {});
    const cancellation = ledger.rows.find((row) => row.isCancellation);
    expect(cancellation?.sourceDocNumber).toBe(removal.adjustmentNumber);

    const last = ledger.rows[ledger.rows.length - 1]!;
    expect(last.stockOnHand).toBe(11);
    expect(last.inventoryAssetValue).toBe(1150);
  });
});
