import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../db/prisma.ts';
import { deleteTestOrganization, uniqueOrgCode } from '../../db/testTenant.ts';
import { getBalance, postMovement } from '../inventory/stock-ledger/stockLedger.service.ts';
import { itemsService } from './items.service.ts';

/**
 * 🔴 THE LEVEL BELOW A BATCH, ON THE ONE SCREEN THAT RE-DECLARES ITSELF.
 *
 * Opening stock is the hardest surface for packages, for exactly the reason it
 * was the hardest for batches: every save is a DELTA against what the document
 * already said, never a rewrite. A batch holding two takas and a loose remainder
 * is THREE positions at one location, each of which the user can edit, delete, or
 * have already issued — so each is settled on its own, and the ORDER between them
 * is load-bearing rather than tidy.
 *
 * `items.openingStock.test.ts` pins the delta behaviour at batch level. This file
 * pins what the level underneath adds, and nothing else.
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

/** A fresh item per test. A save reconciles against every batch the item already
 * has, so a batch left behind by an earlier test is a batch the next test's
 * payload does not mention — sharing the item would chain them together. */
async function freshItem() {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name: 'Grey Fabric',
        sku: `OPENU-${unique()}`,
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
    data: { name: `opening-units-test-${unique()}`, orgCode: uniqueOrgCode() },
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
  // Bottom-up. Packages before batches — a package points at its batch with a
  // RESTRICT key, as the ledger does at both.
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

const balanceOf = (batchId: string, locationId: string) =>
  runAsTenant(orgId, (tx) => getBalance(tx, { organizationId: orgId, batchId, locationId }));

const readBack = (itemId: string) => itemsService.getOpeningStock(itemId, orgId);

/** One location row carrying one batch, so each test states only what it varies. */
function oneBatch(
  openingStock: number,
  batch: Record<string, unknown>,
): Parameters<typeof itemsService.saveOpeningStock>[2] {
  return {
    locationRows: [
      {
        locationId: godownId,
        openingStock,
        openingStockValue: 1,
        batches: [batch],
      },
    ],
  } as Parameters<typeof itemsService.saveOpeningStock>[2];
}

describe('opening stock — declaring packages', () => {
  it('declares packages and a remainder, and the batch total is their sum', async () => {
    const itemId = await freshItem();
    const saved = await itemsService.saveOpeningStock(
      itemId,
      orgId,
      oneBatch(5000, {
        batchReference: 'JV-1',
        quantityIn: 5000,
        units: [
          { label: 'T-1', quantityIn: 1700 },
          { label: 'T-2', quantityIn: 3300 },
        ],
      }),
    );

    const batch = saved[0]!.batches[0]!;
    // 🔴 The batch row still means "how much of this batch is here", and since
    // 2026-09-02 its packages must account for all of it.
    expect(batch.quantityIn).toBe(5000);
    expect(batch.units.map((u) => [u.label, u.quantityIn])).toEqual([
      ['T-1', 1700],
      ['T-2', 3300],
    ]);
    expect(Number((await balanceOf(batch.id, godownId)).qty)).toBe(5000);
  });

  /**
   * 🔴 PARTIAL TAGGING IS NO LONGER LEGAL (2026-09-02). Declaring 2100 of a 5000
   * batch used to pass and leave 2900 untagged; naming any package now commits to
   * naming them all. Naming NONE is still fine — the level stays optional.
   */
  it('refuses packages that account for only part of the batch', async () => {
    const itemId = await freshItem();
    await expect(
      itemsService.saveOpeningStock(
        itemId,
        orgId,
        oneBatch(5000, {
          batchReference: 'JV-1A',
          quantityIn: 5000,
          units: [{ label: 'T-1', quantityIn: 1700 }],
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses packages that add up to more than the batch holds', async () => {
    const itemId = await freshItem();
    await expect(
      itemsService.saveOpeningStock(
        itemId,
        orgId,
        oneBatch(1000, {
          batchReference: 'JV-6',
          quantityIn: 1000,
          units: [
            { label: 'T-1', quantityIn: 700 },
            { label: 'T-2', quantityIn: 700 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses two packages of one batch sharing a label', async () => {
    const itemId = await freshItem();
    await expect(
      itemsService.saveOpeningStock(
        itemId,
        orgId,
        oneBatch(1000, {
          batchReference: 'JV-7',
          quantityIn: 1000,
          units: [
            { label: 'T-1', quantityIn: 500 },
            { label: 't-1', quantityIn: 400 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('opening stock — re-declaring packages is a delta too', () => {
  it('adjusts a package in place across a save, keeping its id', async () => {
    const itemId = await freshItem();
    const first = await itemsService.saveOpeningStock(
      itemId,
      orgId,
      oneBatch(1000, {
        batchReference: 'JV-2',
        quantityIn: 1000,
        units: [
          { label: 'T-1', quantityIn: 600 },
          { label: 'T-2', quantityIn: 400 },
        ],
      }),
    );
    const batchId = first[0]!.batches[0]!.id;
    const [t1, t2] = first[0]!.batches[0]!.units;

    const second = await itemsService.saveOpeningStock(
      itemId,
      orgId,
      oneBatch(1000, {
        id: batchId,
        batchReference: 'JV-2',
        quantityIn: 1000,
        units: [
          // A re-typed tag AND a new quantity, on the same physical package. The
          // pair still totals the batch — partial tagging is refused since
          // 2026-09-02 — so T-2 takes what T-1 gave up.
          { id: t1!.id, label: 'T-1A', quantityIn: 500 },
          { id: t2!.id, label: 'T-2', quantityIn: 500 },
        ],
      }),
    );

    const units = second[0]!.batches[0]!.units;
    // 🔴 The SAME package, adjusted — not reversed and re-created. Re-creating it
    // would strand whatever had already been issued out of the original.
    expect(units.find((u) => u.id === t1!.id)?.label).toBe('T-1A');
    expect(units.find((u) => u.id === t1!.id)?.quantityIn).toBe(500);
    expect(second[0]!.batches[0]!.quantityIn).toBe(1000);
  });

  it('settles the batch total DOWN even when its packages shrink in the same save', async () => {
    const itemId = await freshItem();
    const first = await itemsService.saveOpeningStock(
      itemId,
      orgId,
      oneBatch(1000, {
        batchReference: 'JV-3',
        quantityIn: 1000,
        units: [{ label: 'T-1', quantityIn: 1000 }],
      }),
    );
    const batch = first[0]!.batches[0]!;

    /* 🔴 THE ORDERING TEST. Both the package and the batch shrink. Settle the
       untagged remainder first and `postMovement` refuses the save, because at
       that instant the package still claims 1000 while the batch would hold 600 —
       a state that exists only halfway through its own transaction. */
    await itemsService.saveOpeningStock(
      itemId,
      orgId,
      oneBatch(600, {
        id: batch.id,
        batchReference: 'JV-3',
        quantityIn: 600,
        units: [{ id: batch.units[0]!.id, label: 'T-1', quantityIn: 600 }],
      }),
    );

    expect(Number((await balanceOf(batch.id, godownId)).qty)).toBe(600);
    const after = await readBack(itemId);
    expect(after[0]!.batches[0]!.units[0]!.quantityIn).toBe(600);
  });

  it('adds a package to a batch that already exists, continuing its numbering', async () => {
    const itemId = await freshItem();
    const first = await itemsService.saveOpeningStock(
      itemId,
      orgId,
      oneBatch(1000, {
        batchReference: 'JV-9',
        quantityIn: 1000,
        units: [{ label: 'T-1', quantityIn: 1000 }],
      }),
    );
    const batch = first[0]!.batches[0]!;

    const second = await itemsService.saveOpeningStock(
      itemId,
      orgId,
      oneBatch(1000, {
        id: batch.id,
        batchReference: 'JV-9',
        quantityIn: 1000,
        // Splitting one roll into two. The pair still totals the batch, which the
        // equality rule requires since 2026-09-02.
        units: [
          { id: batch.units[0]!.id, label: 'T-1', quantityIn: 700 },
          { label: 'T-2', quantityIn: 300 },
        ],
      }),
    );

    const units = second[0]!.batches[0]!.units;
    expect(units.map((u) => u.label)).toEqual(['T-1', 'T-2']);
    // seq continues rather than restarting: two packages both called "1" could
    // not be told apart on the goods.
    expect(units.map((u) => u.seq)).toEqual([1, 2]);
    expect(Number((await balanceOf(batch.id, godownId)).qty)).toBe(1000);
  });

  it('removes a package the payload no longer mentions, the rest absorbing its quantity', async () => {
    const itemId = await freshItem();
    const first = await itemsService.saveOpeningStock(
      itemId,
      orgId,
      oneBatch(1000, {
        batchReference: 'JV-4',
        quantityIn: 1000,
        units: [
          { label: 'T-1', quantityIn: 600 },
          { label: 'T-2', quantityIn: 400 },
        ],
      }),
    );
    const batch = first[0]!.batches[0]!;

    await itemsService.saveOpeningStock(
      itemId,
      orgId,
      oneBatch(1000, {
        id: batch.id,
        batchReference: 'JV-4',
        quantityIn: 1000,
        // 🔴 T-2 dropped and T-1 grown to cover it. Since 2026-09-02 the survivors
        // must still account for the whole batch, so dropping a package means
        // saying where its quantity went rather than leaving it untagged.
        units: [{ id: batch.units[0]!.id, label: 'T-1', quantityIn: 1000 }],
      }),
    );

    const row = (await readBack(itemId))[0]!.batches[0]!;
    // The batch still holds 1000 — taking the tag off 400 metres does not throw
    // the metres away.
    expect(row.quantityIn).toBe(1000);
    expect(row.units.map((u) => u.label)).toEqual(['T-1']);

    // …and the package row is gone, so its label is free to be used again.
    const dead = await runAsTenant(orgId, (tx) =>
      tx.batchUnit.findFirstOrThrow({ where: { id: batch.units[1]!.id } }),
    );
    expect(dead.isDeleted).toBe(true);
  });

  it('clears a batch with packages down to nothing, packages first', async () => {
    const itemId = await freshItem();
    const first = await itemsService.saveOpeningStock(
      itemId,
      orgId,
      oneBatch(900, {
        batchReference: 'JV-8',
        quantityIn: 900,
        units: [
          { label: 'T-1', quantityIn: 300 },
          { label: 'T-2', quantityIn: 600 },
        ],
      }),
    );
    const batch = first[0]!.batches[0]!;

    /* 🔴 Two package positions at one location. Zero the batch before its
       packages and `postMovement` refuses, because the packages would momentarily
       claim more than the batch holds. Section 4 settles packages first for
       exactly this reason. */
    await itemsService.saveOpeningStock(itemId, orgId, { locationRows: [] });

    expect(Number((await balanceOf(batch.id, godownId)).qty)).toBe(0);
    const gone = await runAsTenant(orgId, (tx) =>
      tx.batch.findFirstOrThrow({ where: { id: batch.id } }),
    );
    expect(gone.isDeleted).toBe(true);
  });
});

describe('opening stock — what has already moved cannot be un-declared', () => {
  it('refuses to take a package below what has left, and names the package', async () => {
    const itemId = await freshItem();
    const first = await itemsService.saveOpeningStock(
      itemId,
      orgId,
      oneBatch(1000, {
        batchReference: 'JV-5',
        quantityIn: 1000,
        units: [{ label: 'T-1', quantityIn: 1000 }],
      }),
    );
    const batch = first[0]!.batches[0]!;
    const unitId = batch.units[0]!.id;

    // 800 of T-1 goes to the dyer, tagged.
    await runAsTenant(orgId, async (tx) => {
      await postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        batchUnitId: unitId,
        locationId: godownId,
        movementType: 'transfer_out',
        qtyOut: 800,
        sourceDocType: 'test',
      });
      await postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        batchUnitId: unitId,
        locationId: processorId,
        movementType: 'transfer_in',
        qtyIn: 800,
        sourceDocType: 'test',
      });
    });

    /* Only 200 of T-1 is still at the godown, so its opening cannot go below 800.
       🔴 And the message names the PACKAGE: "batch JV-5" is not enough to find a
       row three levels down on your own screen. */
    await expect(
      itemsService.saveOpeningStock(
        itemId,
        orgId,
        oneBatch(100, {
          id: batch.id,
          batchReference: 'JV-5',
          quantityIn: 100,
          units: [{ id: unitId, label: 'T-1', quantityIn: 100 }],
        }),
      ),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('T-1') });

    // Refused whole — nothing was driven negative on the way to failing.
    expect(Number((await balanceOf(batch.id, godownId)).qty)).toBe(200);
  });
});

/**
 * 🔴 WHERE EACH PACKAGE IS — plan §8's first question, on the screen that asks it.
 *
 * "What is in B-1, how much in each, and where" is the Item page's batch grid one
 * level down. A roll standing at the dyer's has to appear under the DYER's row,
 * not the godown's, or the answer to "where is T-1" is wrong in the one way that
 * matters.
 */
describe('item batches — where each package is', () => {
  it('reports each package under the location holding it', async () => {
    const itemId = await freshItem();
    const saved = await itemsService.saveOpeningStock(
      itemId,
      orgId,
      oneBatch(1000, {
        batchReference: 'JV-R1',
        quantityIn: 1000,
        // Accounts for the whole batch, as the equality rule requires since
        // 2026-09-02.
        units: [
          { label: 'T-1', quantityIn: 300 },
          { label: 'T-2', quantityIn: 700 },
        ],
      }),
    );
    const batch = saved[0]!.batches[0]!;
    const t1 = batch.units[0]!.id;

    // T-1 goes to the dyer, tagged — exactly as a challan sends it.
    await runAsTenant(orgId, async (tx) => {
      await postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        batchUnitId: t1,
        locationId: godownId,
        movementType: 'transfer_out',
        qtyOut: 300,
        sourceDocType: 'test',
      });
      await postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        batchUnitId: t1,
        locationId: processorId,
        movementType: 'transfer_in',
        qtyIn: 300,
        sourceDocType: 'test',
      });
    });

    const rows = await itemsService.getItemBatches(itemId, orgId);
    const atGodown = rows.find((r) => r.locationId === godownId)!;
    const atProcessor = rows.find((r) => r.locationId === processorId)!;

    // 🔴 T-1 is at the DYER's now, so it is listed there and nowhere else.
    expect(atProcessor.units.map((u) => u.label)).toEqual(['T-1']);
    expect(atProcessor.units[0]!.availableQty).toBe(300);
    expect(atProcessor.untaggedQty).toBe(0);

    // T-2 stayed. Nothing is loose here — the packages account for the batch.
    expect(atGodown.units.map((u) => u.label)).toEqual(['T-2']);
    expect(atGodown.units[0]!.availableQty).toBe(700);
    expect(atGodown.untaggedQty).toBe(0);
  });

  it('reports no packages at all for a batch that has none', async () => {
    const itemId = await freshItem();
    const saved = await itemsService.saveOpeningStock(
      itemId,
      orgId,
      oneBatch(400, { batchReference: 'JV-PLAIN', quantityIn: 400 }),
    );

    const rows = await itemsService.getItemBatches(itemId, orgId);
    const row = rows.find((r) => r.id === saved[0]!.batches[0]!.id)!;
    // Empty, not absent — the grid renders the row exactly as it always did.
    expect(row.units).toEqual([]);
    expect(row.untaggedQty).toBe(400);
  });
});
