import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runAsTenant } from '../../../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../../../db/testTenant.ts';
import { createBatch, getBalance, postMovement } from '../stock-ledger/stockLedger.service.ts';
import { assembliesService } from './assemblies.service.ts';

/**
 * 🔴 ASSEMBLIES MOVE STOCK — the whole point of this file.
 *
 * Until 2026-09-02 they did not. `createAssembly` wrote `item_assemblies` and
 * nothing else: components were not consumed, the composite was not produced, and
 * assembling a shirt out of fabric and buttons left every balance untouched. It
 * minted a `DEFAULT-<itemId>` batch per component purely to satisfy a NOT NULL
 * column, and `deleteAssembly` said in its own comment that it did not reverse
 * anything.
 *
 * So the first test here is the one that would have failed for a year: after an
 * assembly, is there less fabric and more shirt.
 *
 * 🔴 Every row is created by this file and hard-deleted afterwards — suites run
 * against the dev database IN PARALLEL.
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let userId: string;
let shirtId: string;
let stitchingId: string;
let metreId: string;
let godownId: string;
let otherGodownId: string;
let customerId: string;

/**
 * 🔴 A FRESH COMPONENT ITEM PER TEST, not one shared across the file.
 *
 * FIFO allocates across every batch of an item, so a batch left behind by an
 * earlier test is stock the next test's assembly will happily consume — and the
 * oldest-first, shortfall and ownership cases all turn on exactly which batches
 * exist. Sharing one fabric item makes each test depend on the one before it,
 * which is how this file failed the first time it ran.
 *
 * The COMPOSITE can be shared: it is only ever produced, never consumed.
 */
async function makeItem(
  name: string,
  opts: { structure?: string; type?: string; tracking?: string } = {},
) {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name,
        sku: `ASM-${name}-${unique()}`,
        unit: 'Metre',
        stockingUomId: metreId,
        itemStructure: opts.structure ?? 'simple',
        itemType: opts.type ?? 'goods',
        trackInventory: (opts.type ?? 'goods') !== 'service',
        inventoryTracking: opts.tracking ?? 'batch',
      },
      select: { id: true },
    });
    return item.id;
  });
}

const freshFabric = () => makeItem('Fabric');
const freshThread = () => makeItem('Thread', { tracking: 'none' });

/** Stock of `itemId` at a location, as its own batch. */
async function seed(
  itemId: string,
  qty: number,
  valuePerUnit: number,
  opts: { locationId?: string; ownership?: 'own' | 'customer'; ownerPartyId?: string } = {},
) {
  return runAsTenant(orgId, async (tx) => {
    const batch = await createBatch(tx, {
      organizationId: orgId,
      itemId,
      supplierBatchRef: `SEED-${unique()}`,
      ownership: opts.ownership ?? 'own',
      ownerPartyId: opts.ownerPartyId ?? null,
      sourceDocType: 'test',
    });
    await postMovement(tx, {
      organizationId: orgId,
      batchId: batch.id,
      locationId: opts.locationId ?? godownId,
      movementType: 'receipt',
      qtyIn: qty,
      valueIn: qty * valuePerUnit,
      sourceDocType: 'test',
    });
    return batch;
  });
}

const balanceOf = (batchId: string, locationId?: string) =>
  runAsTenant(orgId, (tx) => getBalance(tx, { organizationId: orgId, batchId, locationId }));

const itemBalance = (itemId: string, locationId = godownId) =>
  runAsTenant(orgId, (tx) => getBalance(tx, { organizationId: orgId, itemId, locationId }));

/** A minimal assembly payload — one composite out of whatever lines are given. */
function payload(lines: unknown[], extra: Record<string, unknown> = {}) {
  return {
    compositeItemId: shirtId,
    assemblyNumber: `ASM-${unique()}`,
    assemblyDate: new Date().toISOString(),
    qty: 10,
    locationId: godownId,
    compositeBatchRef: `SHIRT-${unique()}`,
    lines,
    ...extra,
  } as Parameters<typeof assembliesService.createAssembly>[2];
}

beforeAll(async () => {
  orgId = await createTestOrganization('assembly-ledger');

  const user = await runAsTenant(orgId, async () => null).then(async () => {
    const { prisma } = await import('../../../db/prisma.ts');
    return prisma.user.create({
      data: {
        email: `asm-${unique()}@example.test`,
        passwordHash: 'x',
        firstName: 'Asm',
        fullName: 'Assembly Tester',
      },
      select: { id: true },
    });
  });
  userId = user.id;

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
    otherGodownId = (
      await tx.location.create({
        data: { organizationId: orgId, name: 'Second Godown', type: 'godown' },
        select: { id: true },
      })
    ).id;

    customerId = (
      await tx.customer.create({
        data: {
          organizationId: orgId,
          contactName: 'Principal Mills',
          contactNumber: `CUS-${unique()}`,
        },
        select: { id: true },
      })
    ).id;
  });

  // Produced only, never consumed — so it is safe to share across the file.
  shirtId = await makeItem('Shirt', { structure: 'composite' });
  stitchingId = await makeItem('Stitching', { type: 'service', tracking: 'none' });
});

afterAll(async () => {
  const { prisma } = await import('../../../db/prisma.ts');
  await runAsTenant(orgId, async (tx) => {
    await tx.itemAssemblyActivity.deleteMany({ where: { organizationId: orgId } });
    await tx.itemAssemblyLine.deleteMany({ where: { organizationId: orgId } });
    await tx.itemAssembly.deleteMany({ where: { organizationId: orgId } });
    await tx.stockLedgerEntry.deleteMany({ where: { organizationId: orgId } });
    await tx.batchUnit.deleteMany({ where: { organizationId: orgId } });
    await tx.batch.deleteMany({ where: { organizationId: orgId } });
    await tx.item.deleteMany({ where: { organizationId: orgId } });
    await tx.location.deleteMany({ where: { organizationId: orgId } });
    await tx.customer.deleteMany({ where: { organizationId: orgId } });
    await tx.unitOfMeasurement.deleteMany({ where: { organizationId: orgId } });
    await tx.numberSequence.deleteMany({ where: { organizationId: orgId } });
  });
  await deleteTestOrganization(orgId);
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe('assembly — it actually moves stock', { timeout: 60_000 }, () => {
  it('consumes the components and produces the composite', async () => {
    const fabricId = await freshFabric();
    const threadId = await freshThread();
    const fabric = await seed(fabricId, 100, 50); // ₹5,000
    const thread = await seed(threadId, 40, 10); // ₹400

    const assembly = await assembliesService.createAssembly(
      orgId,
      userId,
      payload([
        { itemId: fabricId, qtyRequired: 20 },
        { itemId: threadId, qtyRequired: 5 },
      ]),
    );

    /**
     * 🔴 THE ASSERTION THAT WOULD HAVE FAILED BEFORE THIS EXISTED. Less fabric,
     * less thread, and a shirt batch that was not there a moment ago.
     */
    expect((await balanceOf(fabric.id)).qty.toString()).toBe('80');
    expect((await balanceOf(thread.id)).qty.toString()).toBe('35');

    const composite = await balanceOf(assembly.compositeBatchId!);
    expect(composite.qty.toString()).toBe('10');

    /* 🔴 VALUE FOLLOWS QUANTITY. 20 M of fabric at ₹50 plus 5 of thread at ₹10 —
       ₹1,050 — is what the shirts are worth, so "what did this cost" is
       answerable off the ledger without anyone storing it twice. */
    expect(composite.value.toString()).toBe('1050');
    expect(assembly.componentValue.toString()).toBe('1050');
    expect(assembly.totalValue.toString()).toBe('1050');
  });

  it('records the genealogy, so a composite can be traced back to what it was made from', async () => {
    const fabricId = await freshFabric();
    const threadId = await freshThread();
    const fabric = await seed(fabricId, 100, 50);
    const thread = await seed(threadId, 40, 10);

    const assembly = await assembliesService.createAssembly(
      orgId,
      userId,
      payload([
        { itemId: fabricId, qtyRequired: 20 },
        { itemId: threadId, qtyRequired: 5 },
      ]),
    );

    const batch = await runAsTenant(orgId, (tx) =>
      tx.batch.findFirstOrThrow({ where: { id: assembly.compositeBatchId! } }),
    );

    // 🔴 Written here or never — genealogy cannot be reconstructed from history
    // that was not recorded. A composite is physically new and has no number of
    // its own, so this list is the ONLY link back.
    expect(new Set(batch.parentBatchIds)).toEqual(new Set([fabric.id, thread.id]));
    expect(batch.sourceDocType).toBe('item_assembly');
  });

  it('spans several batches of one component, oldest first', async () => {
    const fabricId = await freshFabric();
    const older = await seed(fabricId, 12, 50);
    const newer = await seed(fabricId, 100, 60);

    await assembliesService.createAssembly(
      orgId,
      userId,
      payload([{ itemId: fabricId, qtyRequired: 20 }]),
    );

    // FIFO: the older batch is drained before the newer is touched.
    expect((await balanceOf(older.id)).qty.toString()).toBe('0');
    expect((await balanceOf(newer.id)).qty.toString()).toBe('92');
  });

  it('honours the batches the picker chose', async () => {
    const fabricId = await freshFabric();
    const first = await seed(fabricId, 50, 50);
    const second = await seed(fabricId, 50, 50);

    await assembliesService.createAssembly(
      orgId,
      userId,
      payload([
        {
          itemId: fabricId,
          qtyRequired: 20,
          // Deliberately NOT the oldest — a picked batch overrides FIFO.
          batches: [{ batchId: second.id, qty: 20 }],
        },
      ]),
    );

    expect((await balanceOf(first.id)).qty.toString()).toBe('50');
    expect((await balanceOf(second.id)).qty.toString()).toBe('30');
  });

  it('refuses picked batches that do not add up to what the line needs', async () => {
    const fabricId = await freshFabric();
    const fabric = await seed(fabricId, 100, 50);

    await expect(
      assembliesService.createAssembly(
        orgId,
        userId,
        payload([
          { itemId: fabricId, qtyRequired: 20, batches: [{ batchId: fabric.id, qty: 15 }] },
        ]),
      ),
    ).rejects.toMatchObject({ status: 400 });

    // Refused whole — nothing moved on the way to failing.
    expect((await balanceOf(fabric.id)).qty.toString()).toBe('100');
  });

  it('refuses a shortfall by name, and posts nothing', async () => {
    const fabricId = await freshFabric();
    const fabric = await seed(fabricId, 5, 50);

    await expect(
      assembliesService.createAssembly(
        orgId,
        userId,
        payload([{ itemId: fabricId, qtyRequired: 20 }]),
      ),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Fabric') });

    expect((await balanceOf(fabric.id)).qty.toString()).toBe('5');
  });

  it('will not reach stock standing in another godown', async () => {
    const fabricId = await freshFabric();
    await seed(fabricId, 100, 50, { locationId: otherGodownId });

    // The material exists — just not here, and an assembly happens in one place.
    await expect(
      assembliesService.createAssembly(
        orgId,
        userId,
        payload([{ itemId: fabricId, qtyRequired: 20 }]),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('assembly — services and extras', { timeout: 60_000 }, () => {
  it('adds a service to the composite’s value without moving any stock', async () => {
    const fabricId = await freshFabric();
    await seed(fabricId, 100, 50);

    const assembly = await assembliesService.createAssembly(
      orgId,
      userId,
      payload([
        { itemId: fabricId, qtyRequired: 20 },
        // A service has no stock to consume — its money is the only thing real
        // about it, and `additionalCost` is where that belongs.
        { itemId: stitchingId, qtyRequired: 10, unitValue: 40 },
      ]),
    );

    expect(assembly.componentValue.toString()).toBe('1000');
    expect(assembly.additionalCost.toString()).toBe('400');
    expect(assembly.totalValue.toString()).toBe('1400');

    // 🔴 The labour rides on the produced batch, so the shirts cost what they
    // cost to make — not just what their fabric was worth.
    expect((await balanceOf(assembly.compositeBatchId!)).value.toString()).toBe('1400');

    // …and no line was written for it: `item_assembly_lines` is one row per real
    // movement, and a service moved nothing.
    const lines = await runAsTenant(orgId, (tx) =>
      tx.itemAssemblyLine.findMany({ where: { assemblyId: assembly.id } }),
    );
    expect(lines.every((line) => line.itemId !== stitchingId)).toBe(true);
  });
});

describe('assembly — ownership', { timeout: 60_000 }, () => {
  it('refuses to build one item out of two owners’ material', async () => {
    const fabricId = await freshFabric();
    const threadId = await freshThread();
    await seed(fabricId, 100, 50);
    await seed(threadId, 40, 10, { ownership: 'customer', ownerPartyId: customerId });

    await expect(
      assembliesService.createAssembly(
        orgId,
        userId,
        payload([
          { itemId: fabricId, qtyRequired: 20 },
          { itemId: threadId, qtyRequired: 5 },
        ]),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('carries customer ownership through to the composite, at zero value', async () => {
    const fabricId = await freshFabric();
    await seed(fabricId, 100, 50, { ownership: 'customer', ownerPartyId: customerId });

    const assembly = await assembliesService.createAssembly(
      orgId,
      userId,
      payload([{ itemId: fabricId, qtyRequired: 20 }]),
    );

    const batch = await runAsTenant(orgId, (tx) =>
      tx.batch.findFirstOrThrow({ where: { id: assembly.compositeBatchId! } }),
    );
    expect(batch.ownership).toBe('customer');
    expect(batch.ownerPartyId).toBe(customerId);

    // 🔴 Customer-owned stock is never our asset, so it carries no value — and
    // the quantity is still real and still counted.
    const balance = await balanceOf(assembly.compositeBatchId!);
    expect(balance.qty.toString()).toBe('10');
    expect(balance.value.toString()).toBe('0');
  });
});

describe('assembly — cancellation', { timeout: 60_000 }, () => {
  it('puts the components back and un-makes the composite', async () => {
    const fabricId = await freshFabric();
    const threadId = await freshThread();
    const fabric = await seed(fabricId, 100, 50);
    const thread = await seed(threadId, 40, 10);

    const assembly = await assembliesService.createAssembly(
      orgId,
      userId,
      payload([
        { itemId: fabricId, qtyRequired: 20 },
        { itemId: threadId, qtyRequired: 5 },
      ]),
    );

    await assembliesService.deleteAssembly(orgId, assembly.id, userId);

    // 🔴 Every row reversed. Before this, cancelling destroyed the components and
    // left the composite on the books — the exact damage the ledger exists to
    // prevent.
    expect((await balanceOf(fabric.id)).qty.toString()).toBe('100');
    expect((await balanceOf(fabric.id)).value.toString()).toBe('5000');
    expect((await balanceOf(thread.id)).qty.toString()).toBe('40');
    expect((await balanceOf(assembly.compositeBatchId!)).qty.toString()).toBe('0');

    // The history survives: a reversal is a row, never a delete.
    const rows = await runAsTenant(orgId, (tx) =>
      tx.stockLedgerEntry.count({
        where: { organizationId: orgId, sourceDocType: 'item_assembly', sourceDocId: assembly.id },
      }),
    );
    expect(rows).toBe(6);
  });

  it('refuses to cancel once the composite has been used', async () => {
    const fabricId = await freshFabric();
    await seed(fabricId, 100, 50);

    const assembly = await assembliesService.createAssembly(
      orgId,
      userId,
      payload([{ itemId: fabricId, qtyRequired: 20 }]),
    );

    // Something took the shirts onward — a sale, an issue, another assembly.
    await runAsTenant(orgId, (tx) =>
      postMovement(tx, {
        organizationId: orgId,
        batchId: assembly.compositeBatchId!,
        locationId: godownId,
        movementType: 'issue',
        qtyOut: 4,
        sourceDocType: 'test',
      }),
    );

    await expect(
      assembliesService.deleteAssembly(orgId, assembly.id, userId),
    ).rejects.toMatchObject({ status: 409 });

    // Nothing was half-reversed on the way to refusing.
    expect((await balanceOf(assembly.compositeBatchId!)).qty.toString()).toBe('6');
  });

  it('refuses to cancel twice', async () => {
    const fabricId = await freshFabric();
    await seed(fabricId, 100, 50);
    const assembly = await assembliesService.createAssembly(
      orgId,
      userId,
      payload([{ itemId: fabricId, qtyRequired: 20 }]),
    );

    await assembliesService.deleteAssembly(orgId, assembly.id, userId);
    await expect(assembliesService.deleteAssembly(orgId, assembly.id, userId)).rejects.toBeTruthy();
  });
});

describe('assembly — the item balance a user actually reads', { timeout: 60_000 }, () => {
  it('nets out across the whole item, not just one batch', async () => {
    const fabricId = await freshFabric();
    await seed(fabricId, 100, 50);
    const before = await itemBalance(fabricId);

    await assembliesService.createAssembly(
      orgId,
      userId,
      payload([{ itemId: fabricId, qtyRequired: 20 }]),
    );

    const after = await itemBalance(fabricId);
    expect(before.qty.minus(after.qty).toString()).toBe('20');
  });
});
