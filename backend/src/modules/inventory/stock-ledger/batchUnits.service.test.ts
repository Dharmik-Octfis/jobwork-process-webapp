import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { deleteTestOrganization, uniqueOrgCode } from '../../../db/testTenant.ts';
import { ApiError } from '../../../lib/apiError.ts';
import {
  createBatch,
  createBatchUnits,
  getAvailableBatchUnits,
  getBalance,
  getBalancesByBatchUnit,
  postMovement,
  resolveExistingBatchUnits,
} from './stockLedger.service.ts';

/**
 * 🔴 THE LEVEL BELOW A BATCH — a taka, roll, bale — and the four properties that
 * make it safe to have it be OPTIONAL.
 *
 * Everything here is about one design decision: a unit is a LEDGER DIMENSION, not
 * a record with a quantity on it. `batch_units` has no `qty` column, so a unit's
 * quantity and its batch's are the same rows read at two depths and cannot drift.
 * Take that away — store a number on the row — and every test below still passes
 * on the day it is written and starts lying the first time a code path forgets to
 * update it.
 *
 * 🔴 Every row this file touches is created by this file and hard-deleted
 * afterwards. Suites run against the dev database IN PARALLEL, so a test that
 * mutated an org, item or location it merely *found* would break whatever another
 * suite was doing with it at that moment.
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let otherOrgId: string;
let itemId: string;
let uomId: string;
let godownId: string;
let processorId: string;
/** A batch belonging to `otherOrgId`, for the cross-tenant test. */
let foreignUnitId: string;
let foreignBatchId: string;

async function seedOrg(name: string) {
  const org = await prisma.organization.create({
    data: { name: `${name}-${unique()}`, orgCode: uniqueOrgCode() },
    select: { id: true },
  });
  return org.id;
}

beforeAll(async () => {
  orgId = await seedOrg('batch-units-test');
  otherOrgId = await seedOrg('batch-units-other');

  await runAsTenant(orgId, async (tx) => {
    const uom = await tx.unitOfMeasurement.create({
      data: { organizationId: orgId, unitName: 'Metre', symbol: 'MTR' },
      select: { id: true },
    });
    uomId = uom.id;

    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name: 'Grey Fabric',
        sku: `UNITS-${unique()}`,
        unit: 'Metre',
        stockingUomId: uomId,
        inventoryTracking: 'batch',
      },
      select: { id: true },
    });
    itemId = item.id;

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

  // The second tenant's own batch and unit — never touched except by the test
  // that tries to reach it from the first tenant.
  await runAsTenant(otherOrgId, async (tx) => {
    const uom = await tx.unitOfMeasurement.create({
      data: { organizationId: otherOrgId, unitName: 'Metre', symbol: 'MTR' },
      select: { id: true },
    });
    const item = await tx.item.create({
      data: {
        organizationId: otherOrgId,
        name: 'Their Fabric',
        sku: `UNITS-OTHER-${unique()}`,
        unit: 'Metre',
        stockingUomId: uom.id,
        inventoryTracking: 'batch',
      },
      select: { id: true },
    });
    const batch = await createBatch(tx, {
      organizationId: otherOrgId,
      itemId: item.id,
      supplierBatchRef: 'THEIRS',
      sourceDocType: 'test',
    });
    foreignBatchId = batch.id;
    const [unit] = await createBatchUnits(tx, {
      organizationId: otherOrgId,
      batchId: batch.id,
      units: [{ label: 'T-1', qty: 10 }],
    });
    foreignUnitId = unit!.id;
  });
});

afterAll(async () => {
  // Bottom-up: `stock_ledger` and `batch_units` hold RESTRICT foreign keys, so
  // letting the organization cascade would hit them in whatever order Postgres
  // chose. Units before batches — a unit points at its batch.
  for (const id of [orgId, otherOrgId]) {
    await runAsTenant(id, async (tx) => {
      await tx.stockLedgerEntry.deleteMany({ where: { organizationId: id } });
      await tx.batchUnit.deleteMany({ where: { organizationId: id } });
      await tx.batch.deleteMany({ where: { organizationId: id } });
      await tx.item.deleteMany({ where: { organizationId: id } });
      await tx.location.deleteMany({ where: { organizationId: id } });
      await tx.unitOfMeasurement.deleteMany({ where: { organizationId: id } });
      await tx.numberSequence.deleteMany({ where: { organizationId: id } });
    });
    await deleteTestOrganization(id);
  }
});

/**
 * A batch received into the godown, broken into the units given, with whatever is
 * left over posted as the untagged remainder — the exact shape a Bill writes.
 */
async function batchWithUnits(total: number, units: { label: string; qty: number }[]) {
  return runAsTenant(orgId, async (tx) => {
    const batch = await createBatch(tx, {
      organizationId: orgId,
      itemId,
      supplierBatchRef: `REF-${unique()}`,
      sourceDocType: 'test',
    });
    const created = await createBatchUnits(tx, {
      organizationId: orgId,
      batchId: batch.id,
      units: units.map((u) => ({ label: u.label, qty: u.qty })),
      uomId,
    });
    for (const unit of created) {
      await postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        batchUnitId: unit.id,
        locationId: godownId,
        movementType: 'receipt',
        qtyIn: unit.qty,
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
        sourceDocType: 'test',
      });
    }
    return { batch, units: created };
  });
}

describe('batch units — quantity is derived at both levels from the same rows', () => {
  it('each unit holds what was typed, and the batch holds their sum', async () => {
    const { batch, units } = await batchWithUnits(5000, [
      { label: 'T-1', qty: 1700 },
      { label: 'T-2', qty: 400 },
      { label: 'T-3', qty: 2900 },
    ]);

    const balances = await runAsTenant(orgId, async (tx) => ({
      batch: await getBalance(tx, { organizationId: orgId, batchId: batch.id }),
      byUnit: await getBalancesByBatchUnit(tx, { organizationId: orgId, batchIds: [batch.id] }),
    }));

    // 🔴 Not two numbers reconciled against each other — the SAME rows, summed at
    // two depths. There is nothing here that can drift.
    expect(balances.batch.qty.toString()).toBe('5000');
    const byUnit = balances.byUnit.get(batch.id)!;
    expect(byUnit.get(units[0]!.id)!.toString()).toBe('1700');
    expect(byUnit.get(units[1]!.id)!.toString()).toBe('400');
    expect(byUnit.get(units[2]!.id)!.toString()).toBe('2900');
  });

  it('reports the untagged remainder as its own row, not as a loss', async () => {
    const { batch, units } = await batchWithUnits(5000, [{ label: 'T-1', qty: 3000 }]);

    const byUnit = await runAsTenant(orgId, async (tx) =>
      (await getBalancesByBatchUnit(tx, { organizationId: orgId, batchIds: [batch.id] })).get(
        batch.id,
      ),
    );

    expect(byUnit!.get(units[0]!.id)!.toString()).toBe('3000');
    // 🔴 `SUM(units) ≤ batch` is an INEQUALITY. 2000 is loose, physically real,
    // and keyed under `null` so every picker can render it explicitly.
    expect(byUnit!.get(null)!.toString()).toBe('2000');
  });

  it('numbers units within their own batch, starting at 1', async () => {
    const a = await batchWithUnits(200, [
      { label: 'T-1', qty: 100 },
      { label: 'T-2', qty: 100 },
    ]);
    const b = await batchWithUnits(50, [{ label: 'ROLL-9', qty: 50 }]);

    expect(a.units.map((u) => u.seq)).toEqual([1, 2]);
    // A unit has exactly one parent batch and can never merge across batches, so
    // restarting is correct here and would be wrong anywhere else.
    expect(b.units.map((u) => u.seq)).toEqual([1]);
  });
});

describe('batch units — the invariant that makes the level optional', () => {
  it('refuses an untagged issue that would leave the units claiming more than the batch holds', async () => {
    // 5000 in the batch, all of it tagged across three units.
    const { batch } = await batchWithUnits(5000, [
      { label: 'T-1', qty: 1700 },
      { label: 'T-2', qty: 400 },
      { label: 'T-3', qty: 2900 },
    ]);

    // Nothing is untagged, so nothing may leave without naming a unit.
    await expect(
      runAsTenant(orgId, (tx) =>
        postMovement(tx, {
          organizationId: orgId,
          batchId: batch.id,
          locationId: godownId,
          movementType: 'issue',
          qtyOut: 4000,
          sourceDocType: 'job_issue',
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });

    // 🔴 And it was REFUSED, not silently allowed: the balance is untouched.
    const balance = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId: batch.id }),
    );
    expect(balance.qty.toString()).toBe('5000');
  });

  it('allows an untagged issue up to the untagged remainder, and refuses one metre more', async () => {
    const { batch } = await batchWithUnits(5000, [{ label: 'T-1', qty: 3000 }]);

    // 2000 is loose, so 2000 may go.
    await runAsTenant(orgId, (tx) =>
      postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        locationId: godownId,
        movementType: 'issue',
        qtyOut: 2000,
        sourceDocType: 'job_issue',
      }),
    );

    await expect(
      runAsTenant(orgId, (tx) =>
        postMovement(tx, {
          organizationId: orgId,
          batchId: batch.id,
          locationId: godownId,
          movementType: 'issue',
          qtyOut: 1,
          sourceDocType: 'job_issue',
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('never gets in the way of a batch that has no units — every row written before this level existed', async () => {
    const batch = await runAsTenant(orgId, async (tx) => {
      const created = await createBatch(tx, {
        organizationId: orgId,
        itemId,
        supplierBatchRef: `PLAIN-${unique()}`,
        sourceDocType: 'test',
      });
      await postMovement(tx, {
        organizationId: orgId,
        batchId: created.id,
        locationId: godownId,
        movementType: 'receipt',
        qtyIn: 900,
        sourceDocType: 'test',
      });
      return created;
    });

    await runAsTenant(orgId, (tx) =>
      postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        locationId: godownId,
        movementType: 'issue',
        qtyOut: 900,
        sourceDocType: 'job_issue',
      }),
    );

    const balance = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId: batch.id }),
    );
    expect(balance.qty.toString()).toBe('0');
  });

  it('is scoped to ONE LOCATION — a unit at the dyer’s does not lock the godown', async () => {
    const { batch, units } = await batchWithUnits(1000, [{ label: 'T-1', qty: 1000 }]);

    // Send the whole unit to the processor: out of the godown, in at the dyer's.
    await runAsTenant(orgId, async (tx) => {
      await postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        batchUnitId: units[0]!.id,
        locationId: godownId,
        movementType: 'transfer_out',
        qtyOut: 1000,
        sourceDocType: 'job_issue',
      });
      await postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        batchUnitId: units[0]!.id,
        locationId: processorId,
        movementType: 'transfer_in',
        qtyIn: 1000,
        sourceDocType: 'job_issue',
      });
      // Now top the godown up with untagged stock and take it out again. The
      // godown's units net to zero there, so this must be allowed — the 1000 sits
      // at the processor and has nothing to do with it.
      await postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        locationId: godownId,
        movementType: 'receipt',
        qtyIn: 200,
        sourceDocType: 'test',
      });
      await postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        locationId: godownId,
        movementType: 'issue',
        qtyOut: 200,
        sourceDocType: 'job_issue',
      });
    });

    const atProcessor = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId: batch.id, locationId: processorId }),
    );
    expect(atProcessor.qty.toString()).toBe('1000');
  });
});

describe('batch units — a reversal returns the unit to where it was', () => {
  it('cancelling a tagged issue restores the unit balance, not just the batch balance', async () => {
    const { batch, units } = await batchWithUnits(1000, [
      { label: 'T-1', qty: 600 },
      { label: 'T-2', qty: 400 },
    ]);
    const t1 = units[0]!.id;

    await runAsTenant(orgId, (tx) =>
      postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        batchUnitId: t1,
        locationId: godownId,
        movementType: 'transfer_out',
        qtyOut: 600,
        sourceDocType: 'job_issue',
      }),
    );

    // 🔴 The reversal carries `batchUnitId` — the single easiest thing to miss in
    // a cancel path, and the worst to discover. Drop it and the BATCH balance
    // comes back perfectly correct while T-1 stays at zero and an untagged 600
    // appears from nowhere. This test is what fails when that happens.
    await runAsTenant(orgId, (tx) =>
      postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        batchUnitId: t1,
        locationId: godownId,
        movementType: 'reversal',
        qtyIn: 600,
        sourceDocType: 'job_issue',
      }),
    );

    const byUnit = await runAsTenant(orgId, async (tx) =>
      (await getBalancesByBatchUnit(tx, { organizationId: orgId, batchIds: [batch.id] })).get(
        batch.id,
      ),
    );

    expect(byUnit!.get(t1)!.toString()).toBe('600');
    expect(byUnit!.get(units[1]!.id)!.toString()).toBe('400');
    // Nothing leaked into the untagged bucket.
    expect(byUnit!.get(null)).toBeUndefined();
  });
});

describe('batch units — the picker reads the ledger, not the table', () => {
  it('drops a unit once none of it is left here, and keeps it where it went', async () => {
    const { batch, units } = await batchWithUnits(300, [
      { label: 'T-1', qty: 100 },
      { label: 'T-2', qty: 200 },
    ]);

    await runAsTenant(orgId, async (tx) => {
      await postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        batchUnitId: units[0]!.id,
        locationId: godownId,
        movementType: 'transfer_out',
        qtyOut: 100,
        sourceDocType: 'job_issue',
      });
      await postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        batchUnitId: units[0]!.id,
        locationId: processorId,
        movementType: 'transfer_in',
        qtyIn: 100,
        sourceDocType: 'job_issue',
      });
    });

    const [atGodown, atProcessor] = await runAsTenant(orgId, async (tx) => [
      await getAvailableBatchUnits(tx, {
        organizationId: orgId,
        batchIds: [batch.id],
        locationId: godownId,
      }),
      await getAvailableBatchUnits(tx, {
        organizationId: orgId,
        batchIds: [batch.id],
        locationId: processorId,
      }),
    ]);

    // The unit ROW still exists and always will — but there is none of it here.
    expect(atGodown.map((u) => u.batchUnitId)).not.toContain(units[0]!.id);
    expect(atGodown.map((u) => u.batchUnitId)).toContain(units[1]!.id);
    expect(atProcessor.map((u) => u.batchUnitId)).toEqual([units[0]!.id]);
  });
});

/**
 * 🔴 TOPPING UP A UNIT THAT ALREADY EXISTS — the "Existing {unit}" row, and the
 * reason it cannot be a create.
 *
 * `createBatchUnits` refuses a label the batch already carries, because a label
 * is a physical tag. So adding to a roll is a second MOVEMENT against the row
 * that exists, never a second row — which is what keeps the two levels summing
 * from the same ledger instead of two rolls both called "T-1".
 */
describe('batch units — adding to one that already exists', () => {
  it('adds to the unit itself, without creating a second row for the same tag', async () => {
    const { batch, units } = await batchWithUnits(1000, [
      { label: 'T-1', qty: 600 },
      { label: 'T-2', qty: 400 },
    ]);
    const t1 = units[0]!.id;

    await runAsTenant(orgId, async (tx) => {
      const [resolved] = await resolveExistingBatchUnits(tx, {
        organizationId: orgId,
        batchId: batch.id,
        units: [{ batchUnitId: t1, qty: 150 }],
      });
      expect(resolved!.id).toBe(t1);
      // The row it points at, not a new one — same seq, same label.
      expect(resolved!.seq).toBe(units[0]!.seq);
      await postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        batchUnitId: resolved!.id,
        locationId: godownId,
        movementType: 'receipt',
        qtyIn: resolved!.qty,
        sourceDocType: 'bill',
      });
    });

    const [rowCount, byUnit] = await runAsTenant(orgId, async (tx) => [
      await tx.batchUnit.count({ where: { batchId: batch.id, organizationId: orgId } }),
      (await getBalancesByBatchUnit(tx, { organizationId: orgId, batchIds: [batch.id] })).get(
        batch.id,
      ),
    ]);

    // 🔴 Still two rolls, not three. A top-up is quantity, never a new tag.
    expect(rowCount).toBe(2);
    expect(byUnit!.get(t1)!.toString()).toBe('750');
    expect(byUnit!.get(units[1]!.id)!.toString()).toBe('400');
  });

  it('refuses a unit that belongs to a different batch', async () => {
    const a = await batchWithUnits(100, [{ label: 'T-1', qty: 100 }]);
    const b = await batchWithUnits(100, [{ label: 'T-1', qty: 100 }]);

    // Both batches are ours, so RLS sees nothing wrong — this check is the only
    // thing standing between a picked id and stock posted into another lot's roll.
    await expect(
      runAsTenant(orgId, (tx) =>
        resolveExistingBatchUnits(tx, {
          organizationId: orgId,
          batchId: b.batch.id,
          units: [{ batchUnitId: a.units[0]!.id, qty: 10 }],
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a unit belonging to another organization', async () => {
    const { batch } = await batchWithUnits(100, [{ label: 'T-1', qty: 100 }]);

    await expect(
      runAsTenant(orgId, (tx) =>
        resolveExistingBatchUnits(tx, {
          organizationId: orgId,
          batchId: batch.id,
          units: [{ batchUnitId: foreignUnitId, qty: 10 }],
        }),
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('refuses a soft-deleted unit, and the same unit listed twice', async () => {
    const { batch, units } = await batchWithUnits(200, [
      { label: 'T-1', qty: 100 },
      { label: 'T-2', qty: 100 },
    ]);

    await expect(
      runAsTenant(orgId, (tx) =>
        resolveExistingBatchUnits(tx, {
          organizationId: orgId,
          batchId: batch.id,
          units: [
            { batchUnitId: units[0]!.id, qty: 5 },
            { batchUnitId: units[0]!.id, qty: 5 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });

    await runAsTenant(orgId, (tx) =>
      tx.batchUnit.updateMany({
        where: { id: units[1]!.id, organizationId: orgId },
        data: { isDeleted: true },
      }),
    );

    await expect(
      runAsTenant(orgId, (tx) =>
        resolveExistingBatchUnits(tx, {
          organizationId: orgId,
          batchId: batch.id,
          units: [{ batchUnitId: units[1]!.id, qty: 5 }],
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('batch units — what cannot be written', () => {
  it('refuses a unit that belongs to a different batch', async () => {
    const a = await batchWithUnits(100, [{ label: 'T-1', qty: 100 }]);
    const b = await batchWithUnits(100, [{ label: 'T-1', qty: 100 }]);

    await expect(
      runAsTenant(orgId, (tx) =>
        postMovement(tx, {
          organizationId: orgId,
          batchId: b.batch.id,
          batchUnitId: a.units[0]!.id,
          locationId: godownId,
          movementType: 'issue',
          qtyOut: 10,
          sourceDocType: 'test',
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a unit belonging to another organization', async () => {
    const { batch } = await batchWithUnits(100, [{ label: 'T-1', qty: 100 }]);

    // Both the wrong-batch check and RLS stand between this and a written row —
    // either one refusing is the correct outcome; a written row is not.
    await expect(
      runAsTenant(orgId, (tx) =>
        postMovement(tx, {
          organizationId: orgId,
          batchId: batch.id,
          batchUnitId: foreignUnitId,
          locationId: godownId,
          movementType: 'issue',
          qtyOut: 10,
          sourceDocType: 'test',
        }),
      ),
    ).rejects.toBeInstanceOf(ApiError);

    // And the other tenant's batch is not reachable at all from in here.
    const seen = await runAsTenant(orgId, (tx) =>
      tx.batchUnit.findMany({ where: { batchId: foreignBatchId } }),
    );
    expect(seen).toHaveLength(0);
  });

  it('refuses two units of one batch sharing a label — a label is a physical tag', async () => {
    const { batch } = await batchWithUnits(100, [{ label: 'T-1', qty: 100 }]);

    await expect(
      runAsTenant(orgId, (tx) =>
        createBatchUnits(tx, {
          organizationId: orgId,
          batchId: batch.id,
          units: [{ label: 't-1', qty: 5 }],
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a unit with a quantity of zero — the quantity is the required half', async () => {
    const { batch } = await batchWithUnits(100, [{ label: 'T-1', qty: 100 }]);

    await expect(
      runAsTenant(orgId, (tx) =>
        createBatchUnits(tx, {
          organizationId: orgId,
          batchId: batch.id,
          units: [{ label: 'T-9', qty: 0 }],
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  /**
   * 🔴 THE 2026-09-03 RULE, pinned. A label is optional and only the quantity is
   * required; a blank one is auto-filled with `#seq`, its position in the batch.
   *
   * The column stays NOT NULL — every picker, challan and error message reads it,
   * and a package nobody can name is one nobody can pick out of a list. What is
   * gone is the demand that a user INVENT a tag for a roll that does not carry
   * one. Nothing about tracking ever depended on it: quantity and value both hang
   * off `stock_ledger.batch_unit_id`, which is a uuid.
   */
  it('auto-names an unlabelled unit after its position, and keeps them distinct', async () => {
    const { batch } = await batchWithUnits(100, [{ label: 'T-1', qty: 40 }]);

    const created = await runAsTenant(orgId, (tx) =>
      createBatchUnits(tx, {
        organizationId: orgId,
        batchId: batch.id,
        // Blank, whitespace, and absent are all the same thing: no tag.
        units: [{ label: '   ', qty: 20 }, { qty: 20 }, { label: 'T-4', qty: 20 }],
      }),
    );

    expect(created.map((unit) => [unit.seq, unit.label])).toEqual([
      [2, '#2'],
      [3, '#3'],
      [4, 'T-4'],
    ]);

    // Two unnamed packages are two packages, never a duplicate — `seq` is unique
    // inside the batch and never reused, so the names cannot collide.
    const stored = await runAsTenant(orgId, (tx) =>
      tx.batchUnit.findMany({ where: { batchId: batch.id }, select: { label: true } }),
    );
    expect(new Set(stored.map((unit) => unit.label)).size).toBe(4);
  });

  /** The one case an auto-name can collide: somebody typed `#3` by hand. It is
   * refused by name rather than silently merging two rolls under one tag. */
  it('refuses an auto-name that a hand-typed label already occupies', async () => {
    const { batch } = await batchWithUnits(100, [{ label: '#2', qty: 50 }]);

    await expect(
      runAsTenant(orgId, (tx) =>
        createBatchUnits(tx, {
          organizationId: orgId,
          batchId: batch.id,
          units: [{ qty: 50 }],
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('never re-uses a soft-deleted unit’s number', async () => {
    const { batch, units } = await batchWithUnits(100, [{ label: 'T-1', qty: 100 }]);

    await runAsTenant(orgId, (tx) =>
      tx.batchUnit.updateMany({
        where: { id: units[0]!.id, organizationId: orgId },
        data: { isDeleted: true },
      }),
    );

    const [next] = await runAsTenant(orgId, (tx) =>
      createBatchUnits(tx, {
        organizationId: orgId,
        batchId: batch.id,
        units: [{ label: 'T-2', qty: 10 }],
      }),
    );

    // 🔴 seq 2, not 1. The deleted unit still owns the ledger rows posted against
    // it, so handing its number to a live unit would merge two histories under
    // one label — and `@@unique([batchId, seq])` is a FULL index, so it would
    // simply fail.
    expect(next!.seq).toBe(2);
  });
});
