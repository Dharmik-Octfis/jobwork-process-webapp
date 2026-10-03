import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma } from '../../../../generated/prisma/client.ts';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../../../db/testTenant.ts';
import { seedTestReasons } from './adjustmentReasons.testing.ts';
import {
  createBatch,
  createBatchUnits,
  getBalance,
  postMovement,
  reverseMovement,
} from '../stock-ledger/stockLedger.service.ts';
import { checkLayerInvariant } from '../stock-ledger/costLayers.ts';
import { getItemLedger } from '../../reports/inventory-valuation/inventoryValuation.service.ts';
import { getFifoCostLotTracking } from '../../reports/fifo-cost-lot-tracking/fifoCostLotTracking.service.ts';
import { adjustmentsService } from './adjustments.service.ts';
import { saveAdjustmentSchema, type SaveAdjustmentDto } from './adjustments.schemas.ts';

/**
 * Inventory adjustment by VALUE — docs/STOCK_ADJUSTMENT_VALUE_PLAN.md.
 *
 * 🔴 Every row is created by this file and hard-deleted afterwards — suites run
 * against the dev database IN PARALLEL. A fresh item per test: FIFO is per item
 * per location.
 */

const unique = () => process.hrtime.bigint().toString(36);
const DAY = 86_400_000;

let orgId: string;
let userId: string;
let metreId: string;
let godownId: string;

async function makeItem() {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name: `Val ${unique()}`,
        sku: `VAL-${unique()}`,
        unit: 'Metre',
        stockingUomId: metreId,
        itemType: 'goods',
        trackInventory: true,
        inventoryTracking: 'batch',
      },
      select: { id: true },
    });
    return item.id;
  });
}

/**
 * One purchase entry: every row posted under one document id on one date. Each
 * row is its own batch; `units` splits a row into packages.
 */
async function seedEntry(
  itemId: string,
  rows: { qty: number; units?: number[] }[],
  rate: number,
  daysAgo: number,
) {
  const docId = randomUUID();
  const postedAt = new Date(Date.now() - daysAgo * DAY);
  return runAsTenant(orgId, async (tx) => {
    const posted: { batchId: string; batchUnitIds: string[]; entryIds: string[] }[] = [];
    for (const row of rows) {
      const batch = await createBatch(tx, {
        organizationId: orgId,
        itemId,
        supplierBatchRef: `B-${unique()}`,
        sourceDocType: 'test',
      });
      const units = row.units
        ? await createBatchUnits(tx, {
            organizationId: orgId,
            batchId: batch.id,
            units: row.units.map((qty, index) => ({ label: `L${index + 1}`, qty })),
            uomId: batch.uomId,
            sourceDocType: 'test',
            sourceDocId: docId,
          })
        : [];
      const parts = units.length
        ? units.map((unit) => ({ batchUnitId: unit.id, qty: unit.qty }))
        : [{ batchUnitId: null, qty: new Prisma.Decimal(row.qty) }];
      const entryIds: string[] = [];
      for (const part of parts) {
        const entry = await postMovement(tx, {
          organizationId: orgId,
          batchId: batch.id,
          batchUnitId: part.batchUnitId,
          locationId: godownId,
          movementType: 'receipt',
          qtyIn: part.qty,
          valueIn: part.qty.times(rate),
          sourceDocType: 'test',
          sourceDocId: docId,
          postedAt,
        });
        entryIds.push(entry.id);
      }
      posted.push({ batchId: batch.id, batchUnitIds: units.map((unit) => unit.id), entryIds });
    }
    return posted;
  });
}

const balance = (filter: { itemId?: string; batchId?: string; batchUnitId?: string | null }) =>
  runAsTenant(orgId, (tx) =>
    getBalance(tx, { organizationId: orgId, locationId: godownId, ...filter }),
  );

const layersTie = async (itemId: string) =>
  expect(await runAsTenant(orgId, (tx) => checkLayerInvariant(tx, orgId, { itemId }))).toEqual([]);

function payload(
  itemId: string,
  valueAdjusted: number,
  extra: Partial<SaveAdjustmentDto> = {},
): SaveAdjustmentDto {
  return {
    adjustmentType: 'value',
    locationId: godownId,
    adjustmentDate: new Date().toISOString(),
    reasonId: reasons['Write-down to realisable value'],
    lines: [{ itemId, valueAdjusted }],
    saveAs: 'adjust',
    ...extra,
  };
}

const revalue = (itemId: string, valueAdjusted: number, extra: Partial<SaveAdjustmentDto> = {}) =>
  adjustmentsService.createAdjustment(orgId, userId, payload(itemId, valueAdjusted, extra));

/** Your Zoho example: 70 @ ₹100 (older) + 1,000 @ ₹10 (newer) = ₹17,000. */
async function zohoItem() {
  const itemId = await makeItem();
  const old = await seedEntry(itemId, [{ qty: 70 }], 100, 5);
  const bill = await seedEntry(itemId, [{ qty: 1000 }], 10, 1);
  return { itemId, old, bill };
}

let reasons: Awaited<ReturnType<typeof seedTestReasons>>;

beforeAll(async () => {
  orgId = await createTestOrganization('value-adjustment');
  reasons = await seedTestReasons(orgId);
  userId = (
    await prisma.user.create({
      data: {
        email: `val-${unique()}@example.test`,
        passwordHash: 'x',
        firstName: 'Val',
        fullName: 'Value Tester',
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
        data: { organizationId: orgId, name: 'Head Office', type: 'godown' },
        select: { id: true },
      })
    ).id;
  });
});

afterAll(async () => {
  if (orgId) {
    await runAsTenant(orgId, async (tx) => {
      await tx.stockAdjustmentBatch.deleteMany({ where: { organizationId: orgId } });
      await tx.stockAdjustmentLine.deleteMany({ where: { organizationId: orgId } });
      await tx.stockAdjustment.deleteMany({ where: { organizationId: orgId } });
      await tx.stockLayerRevaluation.deleteMany({ where: { organizationId: orgId } });
      await tx.stockLayerDraw.deleteMany({ where: { organizationId: orgId } });
      await tx.stockCostLayer.deleteMany({ where: { organizationId: orgId } });
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

describe('value adjustment — where the change lands', { timeout: 60_000 }, () => {
  it('a decrease lands wholly on the newest purchase entry, moving no stock', async () => {
    const { itemId, old, bill } = await zohoItem();
    const adjustment = await revalue(itemId, -2000);

    expect(adjustment.status).toBe('adjusted');
    expect(adjustment.adjustmentType).toBe('value');
    expect(adjustment.value.toString()).toBe('-2000');
    expect(adjustment.lines[0]!.valueBefore?.toString()).toBe('17000');
    expect(adjustment.lines[0]!.quantityBefore?.toString()).toBe('1070');

    const total = await balance({ itemId });
    expect(total.qty.toString()).toBe('1070');
    expect(total.value.toString()).toBe('15000');
    expect((await balance({ batchId: old[0]!.batchId })).value.toString()).toBe('7000');
    expect((await balance({ batchId: bill[0]!.batchId })).value.toString()).toBe('8000');

    expect(adjustment.valueChanges).toHaveLength(1);
    expect(adjustment.valueChanges[0]).toMatchObject({
      qty: '1000',
      valueBefore: '10000',
      valueAfter: '8000',
      reversed: false,
    });

    const rows = await runAsTenant(orgId, (tx) =>
      tx.stockLedgerEntry.findMany({
        where: { organizationId: orgId, sourceDocId: adjustment.id },
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ movementType: 'revaluation', stockEffect: 'accounting' });
    expect(rows[0]!.qtyIn.toString()).toBe('0');
    expect(rows[0]!.qtyOut.toString()).toBe('0');
    await layersTie(itemId);
  });

  it('an increase lands wholly on the newest entry', async () => {
    const { itemId, old, bill } = await zohoItem();
    await revalue(itemId, 500, { reasonId: reasons['Cost correction'] });

    expect((await balance({ itemId })).value.toString()).toBe('17500');
    expect((await balance({ batchId: old[0]!.batchId })).value.toString()).toBe('7000');
    expect((await balance({ batchId: bill[0]!.batchId })).value.toString()).toBe('10500');
    await layersTie(itemId);
  });

  it('a decrease bigger than the newest entry takes it to zero and spills to the next', async () => {
    const { itemId, old, bill } = await zohoItem();
    const adjustment = await revalue(itemId, -12000);

    expect((await balance({ batchId: bill[0]!.batchId })).value.toString()).toBe('0');
    // ₹10,000 off BILL-020, the other ₹2,000 off the older entry.
    expect((await balance({ batchId: old[0]!.batchId })).value.toString()).toBe('5000');
    expect((await balance({ itemId })).value.toString()).toBe('5000');
    expect(adjustment.valueChanges).toHaveLength(2);
    await layersTie(itemId);
  });

  it('refuses taking off more than is on the books, and leaves nothing behind', async () => {
    const { itemId } = await zohoItem();
    await expect(revalue(itemId, -17000.01)).rejects.toThrow(/cannot be taken off/);
    expect((await balance({ itemId })).value.toString()).toBe('17000');
    const left = await runAsTenant(orgId, (tx) =>
      tx.stockAdjustmentLine.count({ where: { organizationId: orgId, itemId, isDeleted: false } }),
    );
    expect(left).toBe(0);
  });

  it('one entry over two batches and their lots: every unit moves at one rate', async () => {
    const itemId = await makeItem();
    const [b1, b2] = await seedEntry(
      itemId,
      [
        { qty: 600, units: [300, 300] },
        { qty: 400, units: [400] },
      ],
      10,
      1,
    );
    const adjustment = await revalue(itemId, -2000);

    expect((await balance({ batchId: b1!.batchId })).value.toString()).toBe('4800');
    expect((await balance({ batchId: b2!.batchId })).value.toString()).toBe('3200');
    // Each lot keeps its own share: 300 × ₹8.
    const lot = await balance({ batchId: b1!.batchId, batchUnitId: b1!.batchUnitIds[0]! });
    expect(lot.qty.toString()).toBe('300');
    expect(lot.value.toString()).toBe('2400');
    // One purchase entry, reported as one.
    expect(adjustment.valueChanges).toHaveLength(1);
    expect(adjustment.valueChanges[0]).toMatchObject({ qty: '1000', valueAfter: '8000' });
    await layersTie(itemId);
  });

  it('only what is left of an entry is revalued; what was used keeps its cost', async () => {
    const itemId = await makeItem();
    const [row] = await seedEntry(itemId, [{ qty: 1000 }], 10, 2);
    const issued = await runAsTenant(orgId, (tx) =>
      postMovement(tx, {
        organizationId: orgId,
        batchId: row!.batchId,
        locationId: godownId,
        movementType: 'issue',
        qtyOut: 700,
        sourceDocType: 'test',
        postedAt: new Date(Date.now() - DAY),
      }),
    );
    expect(issued.valueOut.toString()).toBe('7000');

    await revalue(itemId, -600);
    const left = await balance({ itemId });
    expect(left.qty.toString()).toBe('300');
    expect(left.value.toString()).toBe('2400');
    await layersTie(itemId);
  });
});

describe('value adjustment — refusals', { timeout: 60_000 }, () => {
  it('no stock here, nothing to revalue', async () => {
    const itemId = await makeItem();
    await expect(revalue(itemId, -10)).rejects.toThrow(/no stock at this location/);
  });

  it('dated before a movement already on the books', async () => {
    const { itemId } = await zohoItem();
    await expect(
      revalue(itemId, -100, { adjustmentDate: new Date(Date.now() - 4 * DAY).toISOString() }),
    ).rejects.toThrow(/stock movements after this date/);
  });

  it('the schema refuses a quantity on a value line', () => {
    const base = payload(randomUUID(), -10);
    expect(
      saveAdjustmentSchema.safeParse({
        ...base,
        lines: [{ itemId: randomUUID(), valueAdjusted: -10, quantityAdjusted: 5 }],
      }).success,
    ).toBe(false);
    expect(saveAdjustmentSchema.safeParse(base).success).toBe(true);
  });

  it('the document that brought the stock in cannot take it back while revalued (V12)', async () => {
    const { itemId, bill } = await zohoItem();
    const adjustment = await revalue(itemId, -2000);

    await expect(
      runAsTenant(orgId, (tx) =>
        reverseMovement(tx, orgId, bill[0]!.entryIds[0]!, { sourceDocType: 'test' }),
      ),
    ).rejects.toThrow(new RegExp(`Cancel stock adjustment ${adjustment.adjustmentNumber} first`));

    // Cancelled, the bill can be reversed again.
    await adjustmentsService.removeAdjustment(orgId, adjustment.id, userId);
    await runAsTenant(orgId, (tx) =>
      reverseMovement(tx, orgId, bill[0]!.entryIds[0]!, { sourceDocType: 'test' }),
    );
    expect((await balance({ itemId })).value.toString()).toBe('7000');
    await layersTie(itemId);
  });
});

describe('value adjustment — cancel and drafts', { timeout: 60_000 }, () => {
  it('cancel gives every layer back exactly what it was given', async () => {
    const { itemId } = await zohoItem();
    const adjustment = await revalue(itemId, -12000);
    const cancelled = await adjustmentsService.removeAdjustment(orgId, adjustment.id, userId);

    expect(cancelled.status).toBe('cancelled');
    expect((await balance({ itemId })).value.toString()).toBe('17000');
    expect(cancelled.valueChanges.every((row) => row.reversed)).toBe(true);
    await layersTie(itemId);
  });

  it('cancel is refused once the changed stock has been drawn on', async () => {
    const { itemId, old } = await zohoItem();
    const adjustment = await revalue(itemId, -2000);
    // FIFO: 70 from the old entry, then 10 from the revalued one.
    await runAsTenant(orgId, (tx) =>
      postMovement(tx, {
        organizationId: orgId,
        batchId: old[0]!.batchId,
        locationId: godownId,
        movementType: 'issue',
        qtyOut: 80,
        sourceDocType: 'test',
      }),
    );
    await expect(adjustmentsService.removeAdjustment(orgId, adjustment.id, userId)).rejects.toThrow(
      /cannot be cancelled/,
    );
    await layersTie(itemId);
  });

  it('cancel is allowed when only untouched entries were drawn on', async () => {
    const { itemId, old } = await zohoItem();
    const adjustment = await revalue(itemId, -2000);
    await runAsTenant(orgId, (tx) =>
      postMovement(tx, {
        organizationId: orgId,
        batchId: old[0]!.batchId,
        locationId: godownId,
        movementType: 'issue',
        qtyOut: 50,
        sourceDocType: 'test',
      }),
    );
    await adjustmentsService.removeAdjustment(orgId, adjustment.id, userId);
    // 20 @ ₹100 + 1,000 @ ₹10.
    expect((await balance({ itemId })).value.toString()).toBe('12000');
    await layersTie(itemId);
  });

  it('a draft holds nothing; Adjust posts it', async () => {
    const { itemId } = await zohoItem();
    const draft = await revalue(itemId, -1000, { saveAs: 'draft' });
    expect(draft.status).toBe('draft');
    expect((await balance({ itemId })).value.toString()).toBe('17000');

    const posted = await adjustmentsService.adjustAdjustment(orgId, draft.id, userId);
    expect(posted.status).toBe('adjusted');
    expect((await balance({ itemId })).value.toString()).toBe('16000');
    await layersTie(itemId);
  });

  it('the item valuation report prints out-at-old / in-at-new, like Zoho', async () => {
    const { itemId } = await zohoItem();
    const adjustment = await revalue(itemId, -2000);
    const { rows } = await getItemLedger(orgId, itemId, {});
    const at = rows.findIndex((row) => row.sourceDocNumber === adjustment.adjustmentNumber);

    expect(rows[at]).toMatchObject({
      transactionDetails: 'Inventory Adjustment By Value',
      quantity: -1000,
      unitCost: 10,
      totalCost: -10000,
      stockOnHand: null,
      inventoryAssetValue: null,
    });
    expect(rows[at + 1]).toMatchObject({
      transactionDetails: '',
      quantity: 1000,
      unitCost: 8,
      totalCost: 8000,
      stockOnHand: 1070,
      inventoryAssetValue: 15000,
    });

    await adjustmentsService.removeAdjustment(orgId, adjustment.id, userId);
    const after = (await getItemLedger(orgId, itemId, {})).rows;
    const cancel = after.findIndex((row) => row.isCancellation);
    expect(after[cancel]).toMatchObject({ quantity: -1000, unitCost: 8 });
    expect(after[cancel + 1]).toMatchObject({ unitCost: 10, inventoryAssetValue: 17000 });
  });

  it('the FIFO cost lot report shows the adjustment as an event on the lot', async () => {
    const { itemId } = await zohoItem();
    const adjustment = await revalue(itemId, -2000);
    const item = await runAsTenant(orgId, (tx) =>
      tx.item.findFirstOrThrow({ where: { id: itemId }, select: { name: true } }),
    );
    const report = await getFifoCostLotTracking(orgId, {
      itemName: item.name,
      page: 1,
      perPage: 50,
    } as Parameters<typeof getFifoCostLotTracking>[1]);
    const event = report.results.find((row) => row.outDocId === adjustment.id);
    expect(event?.outTransaction).toBe(
      `Inventory Adjustment By Value # ${adjustment.adjustmentNumber} (rate 10.00 → 8.00)`,
    );
    expect(event?.outQty).toBeNull();
  });

  it('current values read the layers on hand', async () => {
    const { itemId } = await zohoItem();
    const [row] = await adjustmentsService.currentValues(orgId, {
      locationId: godownId,
      itemIds: [itemId],
    });
    expect(row).toEqual({ itemId, quantity: '1070', value: '17000' });
  });
});
