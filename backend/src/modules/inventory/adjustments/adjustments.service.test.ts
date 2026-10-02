import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../../../db/testTenant.ts';
import {
  createBatch,
  createBatchUnits,
  getBalance,
  postMovement,
  OPENING_STOCK_SOURCE_DOC_TYPE,
} from '../stock-ledger/stockLedger.service.ts';
import { checkLayerInvariant } from '../stock-ledger/costLayers.ts';
import { adjustmentsService } from './adjustments.service.ts';

/**
 * Stock adjustment — docs/STOCK_ADJUSTMENT_PLAN.md §6.
 *
 * 🔴 Every row is created by this file and hard-deleted afterwards — suites run
 * against the dev database IN PARALLEL. And a FRESH ITEM PER TEST: FIFO is per
 * item per location, so stock an earlier test left behind is stock the next one
 * would draw on.
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let userId: string;
let metreId: string;
let godownId: string;
let processorId: string;

async function makeItem(tracking: 'batch' | 'none', type = 'goods') {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name: `Adj ${tracking} ${unique()}`,
        sku: `ADJ-${unique()}`,
        unit: 'Metre',
        stockingUomId: metreId,
        itemType: type,
        trackInventory: type !== 'service',
        inventoryTracking: tracking,
      },
      select: { id: true },
    });
    return item.id;
  });
}

/** Stock of `itemId` in the godown, as its own batch, dated `daysAgo`. */
async function seed(itemId: string, qty: number, valuePerUnit: number, daysAgo = 0, ref = true) {
  return runAsTenant(orgId, async (tx) => {
    const batch = await createBatch(tx, {
      organizationId: orgId,
      itemId,
      supplierBatchRef: ref ? `SEED-${unique()}` : null,
      sourceDocType: 'test',
    });
    await postMovement(tx, {
      organizationId: orgId,
      batchId: batch.id,
      locationId: godownId,
      movementType: 'receipt',
      qtyIn: qty,
      valueIn: qty * valuePerUnit,
      sourceDocType: 'test',
      postedAt: new Date(Date.now() - daysAgo * 86_400_000),
    });
    return batch;
  });
}

const itemBalance = (itemId: string) =>
  runAsTenant(orgId, (tx) =>
    getBalance(tx, { organizationId: orgId, itemId, locationId: godownId }),
  );

const batchBalance = (batchId: string, batchUnitId?: string | null) =>
  runAsTenant(orgId, (tx) =>
    getBalance(tx, { organizationId: orgId, batchId, batchUnitId, locationId: godownId }),
  );

const layersTie = async (itemId: string) =>
  expect(await runAsTenant(orgId, (tx) => checkLayerInvariant(tx, orgId, { itemId }))).toEqual([]);

function payload(itemId: string, quantityAdjusted: number, extra: Record<string, unknown> = {}) {
  return {
    itemId,
    locationId: godownId,
    adjustmentDate: new Date().toISOString(),
    quantityAdjusted,
    reason: quantityAdjusted > 0 ? 'found' : 'damaged',
    ...(quantityAdjusted > 0 ? { costPrice: 100 } : {}),
    ...extra,
  } as Parameters<typeof adjustmentsService.createAdjustment>[2];
}

const adjust = (itemId: string, qty: number, extra: Record<string, unknown> = {}) =>
  adjustmentsService.createAdjustment(orgId, userId, payload(itemId, qty, extra));

beforeAll(async () => {
  orgId = await createTestOrganization('stock-adjustment');
  userId = (
    await prisma.user.create({
      data: {
        email: `adj-${unique()}@example.test`,
        passwordHash: 'x',
        firstName: 'Adj',
        fullName: 'Adjustment Tester',
      },
      select: { id: true },
    })
  ).id;

  await runAsTenant(orgId, async (tx) => {
    metreId = (
      await tx.unitOfMeasurement.create({
        data: { organizationId: orgId, unitName: 'Metre', symbol: 'MTR' },
        select: { id: true },
      })
    ).id;
    godownId = (
      await tx.location.create({
        data: { organizationId: orgId, name: 'Main Godown', type: 'godown' },
        select: { id: true },
      })
    ).id;
    processorId = (
      await tx.location.create({
        data: { organizationId: orgId, name: 'Dyer', type: 'processor' },
        select: { id: true },
      })
    ).id;
  });
});

afterAll(async () => {
  if (orgId) {
    await runAsTenant(orgId, async (tx) => {
      await tx.stockAdjustmentBatch.deleteMany({ where: { organizationId: orgId } });
      await tx.stockAdjustment.deleteMany({ where: { organizationId: orgId } });
      await tx.stockLedgerEntry.deleteMany({ where: { organizationId: orgId } });
      await tx.batchUnit.deleteMany({ where: { organizationId: orgId } });
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

describe('stock adjustment — increase', { timeout: 60_000 }, () => {
  it('untracked item: balance goes up at the stated cost', async () => {
    const itemId = await makeItem('none');
    const adjustment = await adjust(itemId, 5, { costPrice: 100 });

    const balance = await itemBalance(itemId);
    expect(balance.qty.toString()).toBe('5');
    expect(balance.value.toString()).toBe('500');
    expect(adjustment.adjustmentNumber).toMatch(/^ADJ-\d{5}$/);
    expect(adjustment.quantityBefore.toString()).toBe('0');
    expect(adjustment.value.toString()).toBe('500');
    expect(adjustment.status).toBe('adjusted');
    expect(adjustment.batches).toHaveLength(1);
    await layersTie(itemId);
  });

  it('batch-tracked: a new batch and an existing one on the same document', async () => {
    const itemId = await makeItem('batch');
    const existing = await seed(itemId, 10, 50);

    const adjustment = await adjust(itemId, 5, {
      costPrice: 100,
      batches: [
        { supplierBatchRef: `NEW-${unique()}`, quantity: 3 },
        { batchId: existing.id, quantity: 2 },
      ],
    });

    expect((await batchBalance(existing.id)).qty.toString()).toBe('12');
    expect((await itemBalance(itemId)).qty.toString()).toBe('15');
    expect((await itemBalance(itemId)).value.toString()).toBe('1000');
    expect(adjustment.quantityBefore.toString()).toBe('10');
    expect(adjustment.batches).toHaveLength(2);
    await layersTie(itemId);
  });

  it('batch-tracked: packages inside a new batch each get their own row', async () => {
    const itemId = await makeItem('batch');
    const adjustment = await adjust(itemId, 10, {
      costPrice: 30,
      batches: [
        {
          supplierBatchRef: `ROLLS-${unique()}`,
          quantity: 10,
          units: [{ label: 'T-1', quantity: 6 }, { quantity: 4 }],
        },
      ],
    });

    expect(adjustment.batches).toHaveLength(2);
    expect(adjustment.batches.every((row) => row.batchUnitId)).toBe(true);
    expect(adjustment.value.toString()).toBe('300');
    await layersTie(itemId);
  });

  it('refuses batches that do not add up, a missing reference, and a missing cost', async () => {
    const itemId = await makeItem('batch');

    await expect(
      adjust(itemId, 5, { batches: [{ supplierBatchRef: 'A', quantity: 3 }] }),
    ).rejects.toThrow(/add up to 3/);
    await expect(adjust(itemId, 5, { batches: [{ quantity: 5 }] })).rejects.toThrow(
      /needs a reference/,
    );
    await expect(adjust(itemId, 5)).rejects.toThrow(/batches must be named/);
    await expect(
      adjust(itemId, 5, { costPrice: null, batches: [{ supplierBatchRef: 'A', quantity: 5 }] }),
    ).rejects.toThrow(/cost price/);

    // Nothing above may have left a row behind.
    expect((await itemBalance(itemId)).qty.toString()).toBe('0');
  });

  it('refuses an existing batch that belongs to another item', async () => {
    const itemId = await makeItem('batch');
    const other = await seed(await makeItem('batch'), 10, 50);

    await expect(
      adjust(itemId, 5, { batches: [{ batchId: other.id, quantity: 5 }] }),
    ).rejects.toThrow(/does not belong to this item/);
    expect((await batchBalance(other.id)).qty.toString()).toBe('10');
  });
});

describe('stock adjustment — decrease', { timeout: 60_000 }, () => {
  it('untracked item: takes the oldest batch first, at FIFO cost', async () => {
    const itemId = await makeItem('none');
    const older = await seed(itemId, 10, 50, 5, false);
    const newer = await seed(itemId, 10, 80, 1, false);

    const adjustment = await adjust(itemId, -12);

    expect((await batchBalance(older.id)).qty.toString()).toBe('0');
    expect((await batchBalance(newer.id)).qty.toString()).toBe('8');
    // 10 @ 50 + 2 @ 80
    expect(adjustment.value.toString()).toBe('660');
    expect(adjustment.costPrice).toBeNull();
    expect(adjustment.quantityBefore.toString()).toBe('20');
    expect((await itemBalance(itemId)).value.toString()).toBe('640');
    await layersTie(itemId);
  });

  it('batch-tracked: only the named batches move', async () => {
    const itemId = await makeItem('batch');
    const older = await seed(itemId, 10, 50, 5);
    const newer = await seed(itemId, 10, 80, 1);

    await adjust(itemId, -4, { batches: [{ batchId: newer.id, quantity: 4 }] });

    expect((await batchBalance(older.id)).qty.toString()).toBe('10');
    expect((await batchBalance(newer.id)).qty.toString()).toBe('6');
    await layersTie(itemId);
  });

  it('refuses more than a batch holds, and more than the location holds', async () => {
    const itemId = await makeItem('batch');
    const a = await seed(itemId, 10, 50);
    const b = await seed(itemId, 10, 50);

    await expect(
      adjust(itemId, -12, {
        batches: [
          { batchId: a.id, quantity: 11 },
          { batchId: b.id, quantity: 1 },
        ],
      }),
    ).rejects.toThrow(/has 10 available here, but 11 is being removed/);
    await expect(
      adjust(itemId, -25, { batches: [{ batchId: a.id, quantity: 25 }] }),
    ).rejects.toThrow(/has 20 at this location/);
    await expect(adjust(itemId, -5)).rejects.toThrow(/batches must be named/);
    expect((await itemBalance(itemId)).qty.toString()).toBe('20');
  });

  it('packages: a named package, and the untagged remainder limit', async () => {
    const itemId = await makeItem('batch');
    const { batch, unit } = await runAsTenant(orgId, async (tx) => {
      const created = await createBatch(tx, {
        organizationId: orgId,
        itemId,
        supplierBatchRef: `PKG-${unique()}`,
        sourceDocType: 'test',
      });
      const [roll] = await createBatchUnits(tx, {
        organizationId: orgId,
        batchId: created.id,
        units: [{ label: 'T-1', qty: 6 }],
      });
      for (const row of [
        { batchUnitId: roll!.id, qty: 6 },
        { batchUnitId: null, qty: 4 },
      ]) {
        await postMovement(tx, {
          organizationId: orgId,
          batchId: created.id,
          batchUnitId: row.batchUnitId,
          locationId: godownId,
          movementType: 'receipt',
          qtyIn: row.qty,
          valueIn: row.qty * 10,
          sourceDocType: 'test',
        });
      }
      return { batch: created, unit: roll! };
    });

    // 4 are untagged; 5 without naming a package is refused.
    await expect(
      adjust(itemId, -5, { batches: [{ batchId: batch.id, quantity: 5 }] }),
    ).rejects.toThrow(/has 4 available here/);

    await adjust(itemId, -2, {
      batches: [{ batchId: batch.id, batchUnitId: unit.id, quantity: 2 }],
    });
    expect((await batchBalance(batch.id, unit.id)).qty.toString()).toBe('4');
    expect((await batchBalance(batch.id, null)).qty.toString()).toBe('4');
    await layersTie(itemId);
  });

  it('never touches unallocated opening stock', async () => {
    const itemId = await makeItem('batch');
    const holding = await runAsTenant(orgId, async (tx) => {
      const batch = await createBatch(tx, {
        organizationId: orgId,
        itemId,
        sourceDocType: OPENING_STOCK_SOURCE_DOC_TYPE,
        sourceDocId: itemId,
        unallocated: true,
      });
      await postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        locationId: godownId,
        movementType: 'opening',
        qtyIn: 10,
        valueIn: 100,
        sourceDocType: OPENING_STOCK_SOURCE_DOC_TYPE,
        sourceDocId: itemId,
      });
      return batch;
    });

    await expect(
      adjust(itemId, -3, { batches: [{ batchId: holding.id, quantity: 3 }] }),
    ).rejects.toThrow(/has no stock here/);
    await expect(
      adjust(itemId, 3, { batches: [{ batchId: holding.id, quantity: 3 }] }),
    ).rejects.toThrow(/not been assigned to a batch/);
    expect((await batchBalance(holding.id)).qty.toString()).toBe('10');
  });
});

describe('stock adjustment — what it refuses outright', { timeout: 60_000 }, () => {
  it('a processor location, a service item, and a zero quantity', async () => {
    const itemId = await makeItem('none');
    await expect(adjust(itemId, 5, { locationId: processorId })).rejects.toThrow(
      /your own locations/,
    );
    await expect(adjust(await makeItem('none', 'service'), 5)).rejects.toThrow(
      /does not keep stock/,
    );
    await expect(adjust(itemId, 0, { costPrice: 1 })).rejects.toThrow(/quantity to adjust/);
  });

  it('a date before the books begin', async () => {
    const itemId = await makeItem('none');
    await prisma.organization.update({
      where: { id: orgId },
      data: { migrationDate: new Date('2026-06-01') },
    });
    try {
      await expect(
        adjust(itemId, 5, { adjustmentDate: '2026-05-31T00:00:00.000Z' }),
      ).rejects.toThrow(/before your organization's books begin/);
    } finally {
      await prisma.organization.update({ where: { id: orgId }, data: { migrationDate: null } });
    }
  });
});

describe('stock adjustment — cancel', { timeout: 60_000 }, () => {
  it('a decrease: the stock and its cost go back where they came from', async () => {
    const itemId = await makeItem('none');
    const older = await seed(itemId, 10, 50, 5, false);
    await seed(itemId, 10, 80, 1, false);
    const adjustment = await adjust(itemId, -12);

    const cancelled = await adjustmentsService.cancelAdjustment(orgId, adjustment.id, userId);

    expect(cancelled.status).toBe('cancelled');
    expect((await batchBalance(older.id)).qty.toString()).toBe('10');
    const balance = await itemBalance(itemId);
    expect(balance.qty.toString()).toBe('20');
    expect(balance.value.toString()).toBe('1300');
    await layersTie(itemId);

    await expect(adjustmentsService.cancelAdjustment(orgId, adjustment.id, userId)).rejects.toThrow(
      /already cancelled/,
    );
    // Still readable — a cancelled adjustment is not deleted.
    expect((await adjustmentsService.getAdjustment(orgId, adjustment.id)).status).toBe('cancelled');
  });

  it('an increase: the stock is taken back', async () => {
    const itemId = await makeItem('batch');
    const adjustment = await adjust(itemId, 5, {
      batches: [{ supplierBatchRef: `NEW-${unique()}`, quantity: 5 }],
    });

    await adjustmentsService.cancelAdjustment(orgId, adjustment.id, userId);

    const balance = await itemBalance(itemId);
    expect(balance.qty.toString()).toBe('0');
    expect(balance.value.toString()).toBe('0');
    await layersTie(itemId);
  });

  it('an increase whose stock has been used: refused', async () => {
    // The batch is physically short while its layer is intact: older stock paid
    // for the issue, so `reverseMovement`'s cost check alone would let it through.
    const itemId = await makeItem('batch');
    await seed(itemId, 10, 50, 5);
    const added = await adjust(itemId, 5, {
      batches: [{ supplierBatchRef: `NEW-${unique()}`, quantity: 5 }],
    });
    await adjust(itemId, -2, { batches: [{ batchId: added.batches[0]!.batchId, quantity: 2 }] });

    await expect(adjustmentsService.cancelAdjustment(orgId, added.id, userId)).rejects.toThrow(
      /has only 3 left of the 5/,
    );
    expect((await itemBalance(itemId)).qty.toString()).toBe('13');
    await layersTie(itemId);
  });
});
