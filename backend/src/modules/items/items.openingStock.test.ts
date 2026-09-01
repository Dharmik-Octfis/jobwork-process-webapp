import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../db/prisma.ts';
import { getBalance, postMovement } from '../inventory/stock-ledger/stockLedger.service.ts';
import { itemsService } from './items.service.ts';

/**
 * 🔴 OPENING STOCK IS RE-DECLARED, AND RE-DECLARING MUST NOT DESTROY HISTORY.
 *
 * Until 2026-08-13 saving this form reversed every opening movement the item had
 * and re-created the lot from the payload. That is only sound while nothing has
 * left. Batch A opens at 100, 40 go out to a dyer, somebody re-saves — the 100 is
 * reversed at the godown and A lands at MINUS 40, while a brand-new A′ takes the
 * +100. The location total still added up, which is exactly why nobody noticed;
 * the batch history did not, and the 40 sitting at the dyer pointed at a batch
 * with a negative source balance. `getAvailableBatches` filters on a positive
 * balance, so A simply disappeared from every picker rather than raising anything.
 *
 * These tests pin the shape of the fix: a change is a DELTA against what the
 * document already said, batches keep their identity across a save, and a
 * reduction that would take out stock which has already moved is REFUSED by name.
 *
 * 🔴 Every row here is created by this file and hard-deleted afterwards — suites
 * run against the dev database in parallel, so nothing may read or mutate data it
 * did not create.
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let uomId: string;
let godownId: string;
let processorId: string;

/**
 * 🔴 A FRESH ITEM PER TEST, not one shared across the file.
 *
 * Opening stock is declared per ITEM, and a save reconciles against every batch
 * the item already has — so a batch left behind by an earlier test is a batch the
 * next test's payload does not mention, which the delete guard then refuses. That
 * is the guard working; sharing the item would just make each test depend on the
 * one before it.
 */
async function freshItem(inventoryTracking: 'batch' | 'none') {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name: inventoryTracking === 'batch' ? 'Grey Fabric' : 'Packing Tape',
        sku: `OPEN-${unique()}`,
        unit: 'Metre',
        stockingUomId: uomId,
        trackInventory: true,
        inventoryTracking,
      },
      select: { id: true },
    });
    return item.id;
  });
}

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `opening-stock-test-${unique()}`, orgCode: String(Date.now()).slice(-10) },
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

    const processor = await tx.location.create({
      data: { organizationId: orgId, name: 'Sunrise Dyeing', type: 'processor' },
      select: { id: true },
    });
    processorId = processor.id;
  });
});

afterAll(async () => {
  // Bottom-up: `stock_ledger` holds RESTRICT foreign keys to items, batches and
  // locations, so a cascade would hit them in whatever order Postgres chose.
  await runAsTenant(orgId, async (tx) => {
    await tx.stockLedgerEntry.deleteMany({ where: { organizationId: orgId } });
    await tx.itemOpeningStockRow.deleteMany({ where: { organizationId: orgId } });
    await tx.batch.deleteMany({ where: { organizationId: orgId } });
    await tx.item.deleteMany({ where: { organizationId: orgId } });
    await tx.location.deleteMany({ where: { organizationId: orgId } });
    await tx.unitOfMeasurement.deleteMany({ where: { organizationId: orgId } });
    await tx.numberSequence.deleteMany({ where: { organizationId: orgId } });
  });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

/** Send `qty` of a batch off to the processor, the way an issue does. */
async function issueToProcessor(batchId: string, qty: number) {
  await runAsTenant(orgId, async (tx) => {
    await postMovement(tx, {
      organizationId: orgId,
      batchId,
      locationId: godownId,
      movementType: 'transfer_out',
      qtyOut: qty,
      sourceDocType: 'test',
    });
    await postMovement(tx, {
      organizationId: orgId,
      batchId,
      locationId: processorId,
      movementType: 'transfer_in',
      qtyIn: qty,
      sourceDocType: 'test',
    });
  });
}

const balanceOf = (batchId: string, locationId: string) =>
  runAsTenant(orgId, (tx) => getBalance(tx, { organizationId: orgId, batchId, locationId }));

describe('opening stock — re-declaring is a delta, not a rewrite', () => {
  it('keeps the same batch across a save, and adjusts it rather than replacing it', async () => {
    const itemId = await freshItem('batch');
    const first = await itemsService.saveOpeningStock(itemId, orgId, {
      locationRows: [
        {
          locationId: godownId,
          openingStock: 100,
          openingStockValue: 10,
          batches: [{ batchReference: 'ROLL-1', quantityIn: 100 }],
        },
      ],
    });
    const batchId = first[0]!.batches[0]!.id!;
    expect(batchId).toBeTruthy();

    // Same batch, new quantity. The id round-trips, which is what tells the
    // service this is an edit and not a second roll.
    const second = await itemsService.saveOpeningStock(itemId, orgId, {
      locationRows: [
        {
          locationId: godownId,
          openingStock: 140,
          openingStockValue: 10,
          batches: [{ id: batchId, batchReference: 'ROLL-1', quantityIn: 140 }],
        },
      ],
    });

    expect(second[0]!.batches).toHaveLength(1);
    expect(second[0]!.batches[0]!.id).toBe(batchId);
    expect(Number(second[0]!.batches[0]!.quantityIn)).toBe(140);

    const balance = await balanceOf(batchId, godownId);
    expect(Number(balance.qty)).toBe(140);
    // Value follows the quantity — a top-up is worth what the rest of it is.
    expect(Number(balance.value)).toBe(1400);
  });

  it('🔴 refuses to reduce a batch below what has already left, instead of going negative', async () => {
    const itemId = await freshItem('batch');
    const saved = await itemsService.saveOpeningStock(itemId, orgId, {
      locationRows: [
        {
          locationId: godownId,
          openingStock: 100,
          openingStockValue: 5,
          batches: [{ batchReference: 'ROLL-2', quantityIn: 100 }],
        },
      ],
    });
    const batchId = saved[0]!.batches[0]!.id!;

    // 40 metres go to the dyer. They cannot be un-issued by reversing the receipt.
    await issueToProcessor(batchId, 40);
    expect(Number((await balanceOf(batchId, godownId)).qty)).toBe(60);

    // The old code reversed the full 100 here and left the batch at −40.
    await expect(
      itemsService.saveOpeningStock(itemId, orgId, {
        locationRows: [
          {
            locationId: godownId,
            openingStock: 20,
            openingStockValue: 5,
            batches: [{ id: batchId, batchReference: 'ROLL-2', quantityIn: 20 }],
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Deleting the row outright is the same act, and is refused the same way.
    await expect(
      itemsService.saveOpeningStock(itemId, orgId, {
        locationRows: [
          { locationId: godownId, openingStock: 0, openingStockValue: 5, batches: [] },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Nothing was written by either refusal, and nothing went negative.
    expect(Number((await balanceOf(batchId, godownId)).qty)).toBe(60);
    expect(Number((await balanceOf(batchId, processorId)).qty)).toBe(40);
  });

  it('allows a reduction down to what is still there, and removes an untouched batch', async () => {
    const itemId = await freshItem('batch');
    const saved = await itemsService.saveOpeningStock(itemId, orgId, {
      locationRows: [
        {
          locationId: godownId,
          openingStock: 300,
          openingStockValue: 2,
          batches: [
            { batchReference: 'ROLL-3', quantityIn: 200 },
            { batchReference: 'ROLL-4', quantityIn: 100 },
          ],
        },
      ],
    });
    const byRef = new Map(saved[0]!.batches.map((b) => [b.batchReference, b.id!]));
    const rollThree = byRef.get('ROLL-3')!;
    const rollFour = byRef.get('ROLL-4')!;

    await issueToProcessor(rollThree, 50);

    // ROLL-3 down to 150 — exactly the 150 still in the godown, so it is allowed.
    // ROLL-4 dropped from the grid entirely; nothing has moved out of it.
    await itemsService.saveOpeningStock(itemId, orgId, {
      locationRows: [
        {
          locationId: godownId,
          openingStock: 150,
          openingStockValue: 2,
          batches: [{ id: rollThree, batchReference: 'ROLL-3', quantityIn: 150 }],
        },
      ],
    });

    expect(Number((await balanceOf(rollThree, godownId)).qty)).toBe(100); // 150 − 50 issued
    expect(Number((await balanceOf(rollFour, godownId)).qty)).toBe(0);
  });

  /**
   * 🔴 TWO ROWS NAMING ONE BATCH — the case that decides how the settle loop may
   * read its BALANCES (2026-09-01).
   *
   * The guard above ("only N of it is still here") used to re-read the balance on
   * every reduction. Those reads are now hoisted into a map the caller owns, and
   * the map is kept RUNNING as each reversal is posted — because both rows settle
   * the same position, and the second one has to be judged against what the first
   * one already took out. Against a figure read once and left alone the second
   * reduction sails through and drives the batch negative in silence, which is the
   * exact defect `settleOpening`'s own header says it exists to prevent.
   */
  it('judges a repeated row against what the first one already reversed', async () => {
    const itemId = await freshItem('batch');
    const saved = await itemsService.saveOpeningStock(itemId, orgId, {
      locationRows: [
        {
          locationId: godownId,
          openingStock: 100,
          openingStockValue: 2,
          batches: [{ batchReference: 'ROLL-7', quantityIn: 100 }],
        },
      ],
    });
    const rollSeven = saved[0]!.batches[0]!.id!;

    /* The same batch twice, each asking to end at 40 — so each settles the one
       position from 100 down to 40, a 60 reduction, twice. The declared total
       stays at 100 so the "batches exceed the location total" check upstream
       lets this through and the balance guard is the thing under test. */
    await expect(
      itemsService.saveOpeningStock(itemId, orgId, {
        locationRows: [
          {
            locationId: godownId,
            openingStock: 100,
            openingStockValue: 2,
            batches: [
              { id: rollSeven, batchReference: 'ROLL-7', quantityIn: 40 },
              { id: rollSeven, batchReference: 'ROLL-7', quantityIn: 40 },
            ],
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Refused whole, so the batch is untouched — never driven below zero.
    expect(Number((await balanceOf(rollSeven, godownId)).qty)).toBe(100);
  });

  /**
   * 🔴 ONE BATCH, A POSITION AT TWO LOCATIONS — the case that decides how the
   * settle loop may read its batches (2026-09-01).
   *
   * `settleOpening` posted one movement per position and `postMovement` read the
   * batch back on each; those reads are now hoisted into a map the caller owns.
   * The map is MUTABLE for exactly this reason: section 4 soft-deletes a batch
   * while it is still settling positions, and a batch deleted for its godown
   * position must not then be posted against for its processor one. Drop the
   * `settleBatches.delete(...)` and this save quietly succeeds, writing a
   * reversal against a batch that no longer exists.
   */
  it('does not post against a batch it soft-deleted moments earlier', async () => {
    const itemId = await freshItem('batch');
    const saved = await itemsService.saveOpeningStock(itemId, orgId, {
      locationRows: [
        {
          locationId: godownId,
          openingStock: 100,
          openingStockValue: 2,
          batches: [{ batchReference: 'ROLL-9', quantityIn: 100 }],
        },
      ],
    });
    const rollNine = saved[0]!.batches[0]!.id!;

    // A second OPENING position for the same batch, at the processor. Contrived
    // on purpose — it is the shape that makes the two implementations differ,
    // and `openingPositions` keys on (batch, location) precisely because it can.
    await runAsTenant(orgId, (tx) =>
      postMovement(tx, {
        organizationId: orgId,
        batchId: rollNine,
        locationId: processorId,
        movementType: 'opening',
        qtyIn: 25,
        sourceDocType: 'item_opening_stock',
        sourceDocId: itemId,
      }),
    );

    /* Dropping every row makes section 4 settle both positions. The godown one
       goes first and takes the batch with it, so the processor one has nothing
       left to post against — and the save is refused rather than writing it.
       Asserting the refusal, not the message: this is the existing `isDeleted`
       guard surfacing, and it is what must not be lost. */
    await expect(
      itemsService.saveOpeningStock(itemId, orgId, { locationRows: [] }),
    ).rejects.toMatchObject({ status: 404 });

    // The whole save rolled back, so the batch is still there and still whole.
    expect(Number((await balanceOf(rollNine, godownId)).qty)).toBe(100);
  });

  it('reconciles a bulk quantity for an untracked item without minting a batch each save', async () => {
    const bulkItemId = await freshItem('none');
    await itemsService.saveOpeningStock(bulkItemId, orgId, {
      locationRows: [
        { locationId: godownId, openingStock: 500, openingStockValue: 1, batches: [] },
      ],
    });
    await itemsService.saveOpeningStock(bulkItemId, orgId, {
      locationRows: [
        { locationId: godownId, openingStock: 800, openingStockValue: 1, batches: [] },
      ],
    });

    const batches = await runAsTenant(orgId, (tx) =>
      tx.batch.findMany({ where: { organizationId: orgId, itemId: bulkItemId } }),
    );
    // One batch, topped up — not one per save. The old code created a new batch
    // every time and reversed the previous one, so the batch list grew forever.
    expect(batches).toHaveLength(1);
    expect(Number((await balanceOf(batches[0]!.id, godownId)).qty)).toBe(800);
  });
});
