import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../db/prisma.ts';
import { deleteTestOrganization, uniqueOrgCode } from '../../db/testTenant.ts';
import {
  getAvailableBatches,
  getBalanceByLocation,
  postMovement,
  UNALLOCATED_BATCH_STATE,
} from '../inventory/stock-ledger/stockLedger.service.ts';
import { getSourceLocations } from '../inventory/batches/batches.service.ts';
import { itemsService } from './items.service.ts';

/**
 * 🔴 UNALLOCATED OPENING STOCK IS STOCK, BUT IT CANNOT BE ISSUED (2026-09-11).
 *
 * A batch-tracked location may declare more opening stock than its batch rows
 * hold. The difference used to be a number on the declaration and nothing on the
 * books: 500 declared with 150 in batches showed 150 on hand. It now posts to one
 * holding batch per location — counted on hand, hidden from every picker, and
 * released only by assigning it to a batch on a later opening-stock save.
 *
 * 🔴 Own org, own fixtures, hard-deleted afterwards — suites run in parallel.
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let uomId: string;
let godownId: string;

async function freshItem() {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name: 'Grey Fabric',
        sku: `UNALLOC-${unique()}`,
        unit: 'Metre',
        stockingUomId: uomId,
        trackInventory: true,
        inventoryTracking: 'batch',
      },
      select: { id: true },
    });
    return item.id;
  });
}

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `opening-unallocated-${unique()}`, orgCode: uniqueOrgCode() },
    select: { id: true },
  });
  orgId = org.id;

  await runAsTenant(orgId, async (tx) => {
    const uom = await tx.unitOfMeasurement.create({
      data: { organizationId: orgId, unitName: 'Metre', symbol: 'MTR' },
      select: { id: true },
    });
    uomId = uom.id;
    const godown = await tx.location.create({
      data: { organizationId: orgId, name: 'Main Godown', type: 'godown' },
      select: { id: true },
    });
    godownId = godown.id;
  });
});

afterAll(async () => {
  await runAsTenant(orgId, async (tx) => {
    await tx.stockLedgerEntry.deleteMany({ where: { organizationId: orgId } });
    await tx.itemOpeningStockRow.deleteMany({ where: { organizationId: orgId } });
    await tx.batchUnit.deleteMany({ where: { organizationId: orgId } });
    await tx.batch.deleteMany({ where: { organizationId: orgId } });
    await tx.item.deleteMany({ where: { organizationId: orgId } });
    await tx.location.deleteMany({ where: { organizationId: orgId } });
    await tx.unitOfMeasurement.deleteMany({ where: { organizationId: orgId } });
    await tx.numberSequence.deleteMany({ where: { organizationId: orgId } });
  });
  await deleteTestOrganization(orgId);
});

const onHandAtGodown = async (itemId: string) =>
  Number(
    (
      await runAsTenant(orgId, (tx) => getBalanceByLocation(tx, { organizationId: orgId, itemId }))
    ).get(godownId)?.qty ?? 0,
  );

const holdingBatchOf = (itemId: string) =>
  runAsTenant(orgId, (tx) =>
    tx.batch.findFirst({
      where: { organizationId: orgId, itemId, state: UNALLOCATED_BATCH_STATE, isDeleted: false },
      select: { id: true },
    }),
  );

/** 500 declared at the godown, 150 of it in batch ROLL-1. */
const declare500With150 = (itemId: string) =>
  itemsService.saveOpeningStock(itemId, orgId, {
    locationRows: [
      {
        locationId: godownId,
        openingStock: 500,
        openingStockValue: 10,
        batches: [{ batchReference: 'ROLL-1', quantityIn: 150 }],
      },
    ],
  });

describe('opening stock — the unallocated remainder', () => {
  it('posts the remainder and counts it on hand, but not as available', async () => {
    const itemId = await freshItem();
    const [row] = await declare500With150(itemId);

    expect(await onHandAtGodown(itemId)).toBe(500);
    expect(row!.stockOnHand).toBe(500);
    expect(row!.unallocatedQty).toBe(350);
    expect(row!.availableForSale).toBe(150);
    // The holding batch is not a batch row — the form would send it back as one.
    expect(row!.batches).toHaveLength(1);
    expect(row!.batches[0]!.batchReference).toBe('ROLL-1');
  });

  it('is never offered, and cannot be moved by anything but opening stock', async () => {
    const itemId = await freshItem();
    await declare500With150(itemId);
    const holding = await holdingBatchOf(itemId);
    expect(holding).not.toBeNull();

    const offered = await runAsTenant(orgId, (tx) =>
      getAvailableBatches(tx, { organizationId: orgId, itemId, locationId: godownId }),
    );
    expect(offered.map((b) => b.supplierBatchRef)).toEqual(['ROLL-1']);

    // The Issue dialog's "which godown" chooser sees only what can be picked.
    const sources = await getSourceLocations(orgId, { itemIds: [itemId] });
    expect(sources.find((s) => s.id === godownId)?.availableQty).toBe('150');

    // Out — an issue — and in — a bill topping it up — are both refused.
    await expect(
      runAsTenant(orgId, (tx) =>
        postMovement(tx, {
          organizationId: orgId,
          batchId: holding!.id,
          locationId: godownId,
          movementType: 'issue',
          qtyOut: 10,
          sourceDocType: 'job_issue',
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      runAsTenant(orgId, (tx) =>
        postMovement(tx, {
          organizationId: orgId,
          batchId: holding!.id,
          locationId: godownId,
          movementType: 'receipt',
          qtyIn: 10,
          sourceDocType: 'bill',
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('releases exactly what a later save assigns to a batch', async () => {
    const itemId = await freshItem();
    const [first] = await declare500With150(itemId);
    const rollId = first!.batches[0]!.id;

    const [row] = await itemsService.saveOpeningStock(itemId, orgId, {
      locationRows: [
        {
          locationId: godownId,
          openingStock: 500,
          openingStockValue: 10,
          batches: [
            { id: rollId, batchReference: 'ROLL-1', quantityIn: 150 },
            { batchReference: 'ROLL-2', quantityIn: 200 },
          ],
        },
      ],
    });

    // Same total on hand; 200 moved out of the holding batch into ROLL-2.
    expect(await onHandAtGodown(itemId)).toBe(500);
    expect(row!.unallocatedQty).toBe(150);
    expect(row!.availableForSale).toBe(350);

    const offered = await runAsTenant(orgId, (tx) =>
      getAvailableBatches(tx, { organizationId: orgId, itemId, locationId: godownId }),
    );
    expect(offered.map((b) => b.supplierBatchRef).sort()).toEqual(['ROLL-1', 'ROLL-2']);
  });

  it('follows the declared figure down and up, and goes when the location does', async () => {
    const itemId = await freshItem();
    const [first] = await declare500With150(itemId);
    const rollId = first!.batches[0]!.id;
    const save = (openingStock: number) =>
      itemsService.saveOpeningStock(itemId, orgId, {
        locationRows: [
          {
            locationId: godownId,
            openingStock,
            openingStockValue: 10,
            batches: [{ id: rollId, batchReference: 'ROLL-1', quantityIn: 150 }],
          },
        ],
      });

    expect((await save(300))[0]!.unallocatedQty).toBe(150);
    expect(await onHandAtGodown(itemId)).toBe(300);
    expect((await save(800))[0]!.unallocatedQty).toBe(650);
    expect(await onHandAtGodown(itemId)).toBe(800);
    // Fully assigned: nothing left to hold.
    expect((await save(150))[0]!.unallocatedQty).toBe(0);
    expect(await onHandAtGodown(itemId)).toBe(150);

    await save(400);
    await itemsService.saveOpeningStock(itemId, orgId, { locationRows: [] });
    expect(await onHandAtGodown(itemId)).toBe(0);
  });
});
