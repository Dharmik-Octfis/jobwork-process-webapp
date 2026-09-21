import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../../../db/testTenant.ts';
import {
  createBatch,
  createBatchUnits,
  getBalance,
  getBalancesByBatchUnit,
  postMovement,
} from '../stock-ledger/stockLedger.service.ts';
import { assembliesService } from './assemblies.service.ts';

/**
 * 🔴 THE PACKAGE LEVEL ON AN ASSEMBLY — the last surface, and the one where a
 * package behaves differently from everywhere else.
 *
 * An assembly consumes material where it stands. Cutting 20 m off a 100 m roll is
 * the ordinary case, so a line takes a QUANTITY out of a package rather than the
 * package whole, and what is left stays that roll's — not an untagged remnant
 * nobody can trace back to it.
 *
 * The other thing worth pinning is package-aware FIFO: a batch whose rolls hold
 * all of it has nothing untagged, so drawing on the batch generally would be
 * refused by the invariant. The allocator drains untagged first, then roll by
 * roll in `seq` order.
 *
 * 🔴 Every row is created by this file and hard-deleted afterwards — suites run
 * against the dev database IN PARALLEL.
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let userId: string;
let shirtId: string;
let metreId: string;
let godownId: string;

async function makeItem(name: string, opts: { structure?: string } = {}) {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name,
        sku: `AU-${name}-${unique()}`,
        unit: 'Metre',
        stockingUomId: metreId,
        itemStructure: opts.structure ?? 'simple',
        itemType: 'goods',
        trackInventory: true,
        inventoryTracking: 'batch',
      },
      select: { id: true },
    });
    return item.id;
  });
}

/** A fabric batch at the godown, broken into the packages given, with whatever is
 * left over posted as the untagged remainder. */
async function stockWithUnits(
  itemId: string,
  total: number,
  units: { label: string; qty: number }[],
) {
  return runAsTenant(orgId, async (tx) => {
    const batch = await createBatch(tx, {
      organizationId: orgId,
      itemId,
      supplierBatchRef: `SEED-${unique()}`,
      sourceDocType: 'test',
    });
    const created = await createBatchUnits(tx, {
      organizationId: orgId,
      batchId: batch.id,
      units: units.map((u) => ({ label: u.label, qty: u.qty })),
      uomId: metreId,
    });
    for (const unit of created) {
      await postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        batchUnitId: unit.id,
        locationId: godownId,
        movementType: 'receipt',
        qtyIn: unit.qty,
        valueIn: unit.qty.times(50),
        sourceDocType: 'test',
      });
    }
    const tagged = units.reduce((sum, u) => sum + u.qty, 0);
    if (total - tagged > 0.00005) {
      await postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        locationId: godownId,
        movementType: 'receipt',
        qtyIn: total - tagged,
        valueIn: (total - tagged) * 50,
        sourceDocType: 'test',
      });
    }
    return { batch, units: created };
  });
}

const unitsAt = (batchId: string) =>
  runAsTenant(orgId, async (tx) =>
    (
      await getBalancesByBatchUnit(tx, {
        organizationId: orgId,
        batchIds: [batchId],
        locationId: godownId,
      })
    ).get(batchId),
  );

const balanceOf = (batchId: string) =>
  runAsTenant(orgId, (tx) => getBalance(tx, { organizationId: orgId, batchId }));

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
  orgId = await createTestOrganization('assembly-units');

  const user = await prisma.user.create({
    data: {
      email: `asmu-${unique()}@example.test`,
      passwordHash: 'x',
      firstName: 'Asm',
      fullName: 'Assembly Units Tester',
    },
    select: { id: true },
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
  });

  shirtId = await makeItem('Shirt', { structure: 'composite' });
});

afterAll(async () => {
  await runAsTenant(orgId, async (tx) => {
    await tx.itemAssemblyActivity.deleteMany({ where: { organizationId: orgId } });
    await tx.itemAssemblyLine.deleteMany({ where: { organizationId: orgId } });
    await tx.itemAssembly.deleteMany({ where: { organizationId: orgId } });
    await tx.stockLedgerEntry.deleteMany({ where: { organizationId: orgId } });
    await tx.batchUnit.deleteMany({ where: { organizationId: orgId } });
    await tx.batch.deleteMany({ where: { organizationId: orgId } });
    await tx.item.deleteMany({ where: { organizationId: orgId } });
    await tx.location.deleteMany({ where: { organizationId: orgId } });
    await tx.unitOfMeasurement.deleteMany({ where: { organizationId: orgId } });
    await tx.numberSequence.deleteMany({ where: { organizationId: orgId } });
  });
  await deleteTestOrganization(orgId);
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe('assembly — consuming out of a package', { timeout: 60_000 }, () => {
  it('cuts part of a roll and leaves the rest as that roll', async () => {
    const fabricId = await makeItem('Fabric');
    const { batch, units } = await stockWithUnits(fabricId, 200, [{ label: 'T-1', qty: 100 }]);

    const assembly = await assembliesService.createAssembly(
      orgId,
      userId,
      payload([
        {
          itemId: fabricId,
          qtyRequired: 20,
          batches: [{ batchId: batch.id, batchUnitId: units[0]!.id, qty: 20 }],
        },
      ]),
    );

    /* 🔴 THE DIFFERENCE FROM AN ISSUE. 80 m of T-1 is still on the shelf and it
       is still T-1 — the roll was cut, not sent. An untagged 80 here would be
       material nobody could trace back to the roll it came off. */
    const byUnit = (await unitsAt(batch.id))!;
    expect(byUnit.get(units[0]!.id)!.toString()).toBe('80');
    expect(byUnit.get(null)!.toString()).toBe('100');

    // …and the line records which roll it was cut from.
    const line = await runAsTenant(orgId, (tx) =>
      tx.itemAssemblyLine.findFirstOrThrow({ where: { assemblyId: assembly.id } }),
    );
    expect(line.batchUnitId).toBe(units[0]!.id);
  });

  it('refuses more than a roll holds', async () => {
    const fabricId = await makeItem('Fabric');
    const { batch, units } = await stockWithUnits(fabricId, 200, [{ label: 'T-1', qty: 30 }]);

    await expect(
      assembliesService.createAssembly(
        orgId,
        userId,
        payload([
          {
            itemId: fabricId,
            qtyRequired: 50,
            batches: [{ batchId: batch.id, batchUnitId: units[0]!.id, qty: 50 }],
          },
        ]),
      ),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('T-1') });

    expect((await balanceOf(batch.id)).qty.toString()).toBe('200');
  });

  it('refuses a roll that is not in the batch beside it', async () => {
    const fabricId = await makeItem('Fabric');
    const a = await stockWithUnits(fabricId, 100, [{ label: 'T-1', qty: 100 }]);
    const b = await stockWithUnits(fabricId, 100, [{ label: 'T-1', qty: 100 }]);

    await expect(
      assembliesService.createAssembly(
        orgId,
        userId,
        payload([
          {
            itemId: fabricId,
            qtyRequired: 20,
            batches: [{ batchId: b.batch.id, batchUnitId: a.units[0]!.id, qty: 20 }],
          },
        ]),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('assembly — package-aware FIFO', { timeout: 60_000 }, () => {
  /**
   * 🔴 THE CASE THAT WOULD OTHERWISE DEAD-END. A batch whose rolls hold ALL of it
   * has nothing untagged, so drawing on the batch generally is refused by
   * `postMovement`'s invariant. FIFO has to name the rolls itself.
   */
  it('allocates out of the rolls when the batch is fully tagged', async () => {
    const fabricId = await makeItem('Fabric');
    const { batch, units } = await stockWithUnits(fabricId, 100, [
      { label: 'T-1', qty: 40 },
      { label: 'T-2', qty: 60 },
    ]);

    await assembliesService.createAssembly(
      orgId,
      userId,
      // No batches picked — the server has to work it out, and cannot use the
      // untagged pool because there is none.
      payload([{ itemId: fabricId, qtyRequired: 70 }]),
    );

    const byUnit = (await unitsAt(batch.id))!;
    // T-1 drained first (lower `seq`), then 30 off T-2.
    expect(byUnit.get(units[0]!.id)!.toString()).toBe('0');
    expect(byUnit.get(units[1]!.id)!.toString()).toBe('30');
  });

  it('takes the untagged remainder before breaking into a roll', async () => {
    const fabricId = await makeItem('Fabric');
    const { batch, units } = await stockWithUnits(fabricId, 100, [{ label: 'T-1', qty: 60 }]);

    await assembliesService.createAssembly(
      orgId,
      userId,
      payload([{ itemId: fabricId, qtyRequired: 30 }]),
    );

    const byUnit = (await unitsAt(batch.id))!;
    /* 🔴 Untagged first. That material belongs to no roll, so taking it leaves
       every roll intact — breaking one open for no reason is the alternative. */
    expect(byUnit.get(null)!.toString()).toBe('10');
    expect(byUnit.get(units[0]!.id)!.toString()).toBe('60');
  });
});

describe('assembly — the composite comes out in packages too', { timeout: 60_000 }, () => {
  it('boxes the output and conserves its value', async () => {
    const fabricId = await makeItem('Fabric');
    await stockWithUnits(fabricId, 200, []);

    const assembly = await assembliesService.createAssembly(
      orgId,
      userId,
      payload([{ itemId: fabricId, qtyRequired: 20 }], {
        compositeUnits: [
          { label: 'BOX-1', qty: 6 },
          { label: 'BOX-2', qty: 4 },
        ],
      }),
    );

    const byUnit = (await unitsAt(assembly.compositeBatchId!))!;
    expect([...byUnit.values()].map((q) => q.toString()).sort()).toEqual(['4', '6']);
    expect(byUnit.get(null)).toBeUndefined();

    // 🔴 The batch is worth exactly what it would have been unboxed — a package
    // carries no value of its own, it inherits its batch's weighted average.
    expect((await balanceOf(assembly.compositeBatchId!)).value.toString()).toBe('1000');
  });

  /**
   * 🔴 PARTIAL BOXING IS NO LONGER LEGAL (2026-09-02). This asserted the opposite
   * until then — 6 of 10 boxed left 4 untagged and passed. Naming any package now
   * commits to naming them all, the same equality bills, receipts and opening
   * stock enforce.
   */
  it('refuses output packages that box only part of what was assembled', async () => {
    const fabricId = await makeItem('Fabric');
    await stockWithUnits(fabricId, 200, []);

    await expect(
      assembliesService.createAssembly(
        orgId,
        userId,
        payload([{ itemId: fabricId, qtyRequired: 20 }], {
          compositeUnits: [{ label: 'BOX-1', qty: 6 }],
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('still accepts output that names NO packages — the level stays optional', async () => {
    const fabricId = await makeItem('Fabric');
    await stockWithUnits(fabricId, 200, []);

    const assembly = await assembliesService.createAssembly(
      orgId,
      userId,
      payload([{ itemId: fabricId, qtyRequired: 20 }]),
    );

    const byUnit = (await unitsAt(assembly.compositeBatchId!))!;
    // The whole output is untagged, exactly as before the level existed.
    expect(byUnit.get(null)!.toString()).toBe('10');
    expect((await balanceOf(assembly.compositeBatchId!)).value.toString()).toBe('1000');
  });

  it('refuses output packages that hold more than was assembled', async () => {
    const fabricId = await makeItem('Fabric');
    await stockWithUnits(fabricId, 200, []);

    await expect(
      assembliesService.createAssembly(
        orgId,
        userId,
        payload([{ itemId: fabricId, qtyRequired: 20 }], {
          compositeUnits: [{ label: 'BOX-1', qty: 11 }],
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('assembly — cancellation with packages', { timeout: 60_000 }, () => {
  it('returns the material to the roll it was cut from', async () => {
    const fabricId = await makeItem('Fabric');
    const { batch, units } = await stockWithUnits(fabricId, 100, [{ label: 'T-1', qty: 100 }]);

    const assembly = await assembliesService.createAssembly(
      orgId,
      userId,
      payload([
        {
          itemId: fabricId,
          qtyRequired: 20,
          batches: [{ batchId: batch.id, batchUnitId: units[0]!.id, qty: 20 }],
        },
      ]),
    );

    await assembliesService.deleteAssembly(orgId, assembly.id, userId);

    /**
     * 🔴 Back to 100 ON THE ROLL, not 80 on the roll and 20 untagged. The batch
     * balance returns to 100 either way — which is exactly what would hide the
     * bug if the reversal dropped `batchUnitId`.
     */
    const byUnit = (await unitsAt(batch.id))!;
    expect(byUnit.get(units[0]!.id)!.toString()).toBe('100');
    expect(byUnit.get(null)).toBeUndefined();
  });
});
