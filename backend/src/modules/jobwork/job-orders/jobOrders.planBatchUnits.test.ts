import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runAsTenant } from '../../../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../../../db/testTenant.ts';
import {
  createBatch,
  createBatchUnits,
  postMovement,
} from '../../inventory/stock-ledger/stockLedger.service.ts';
import { SOURCE_DOC_TYPES, runAsDocument } from '../jobwork.types.ts';
import { createNewProcess } from '../processes/processes.service.ts';
import { createNewJobOrder, updateJobOrderById } from './jobOrders.service.ts';

/**
 * 🔴 PLANNING A PACKAGE — a note, and still only a note.
 *
 * A plan may now say "run roll T-2 through dyeing", not just "run batch JV-1".
 * It holds NOTHING: availability is a ledger query and does not subtract plans, so
 * the same roll can be planned by two orders and issued by one. That trade is the
 * model (`JobOrderStepInputBatch`), and the package level does not change it.
 *
 * The one thing here that is easy to get wrong and expensive to discover is the
 * UNIQUE INDEX. Adding a nullable column to `(input, batch, location)` makes
 * Postgres treat two untagged rows as distinct — `NULL <> NULL` — so the
 * constraint silently stops constraining exactly the row shape it was written
 * for. The migration builds it `NULLS NOT DISTINCT`; the last test here is what
 * fails if that clause is ever lost.
 *
 * 🔴 Every row is created by this file and hard-deleted afterwards — suites run
 * against the dev database IN PARALLEL.
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let greyId: string;
let dyedId: string;
let metreId: string;
let godownId: string;
let dyerId: string;
let processId: string;

async function stockWithUnits(total: number, units: { label: string; qty: number }[]) {
  return runAsDocument(orgId, async (tx) => {
    const batch = await createBatch(tx, {
      organizationId: orgId,
      itemId: greyId,
      ownership: 'own',
      supplierBatchRef: `SEED-${unique()}`,
      sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
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
        valueIn: unit.qty.times(10),
        sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
        sourceDocId: batch.id,
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
        valueIn: (total - tagged) * 10,
        sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
        sourceDocId: batch.id,
      });
    }
    return { batch, units: created };
  });
}

/** A one-step order whose single input plans the rows given. */
function orderWith(plannedQty: number, plannedBatches: unknown[]) {
  return {
    steps: [
      {
        processId,
        processorType: 'vendor',
        processorId: dyerId,
        rate: 10,
        rateBasis: 'per_issued_unit',
        inputs: [{ itemId: greyId, plannedQty, plannedBatches }],
        outputs: [{ itemId: dyedId, isPrimary: true }],
        plannedInputQty: plannedQty,
      },
    ],
  } as Parameters<typeof createNewJobOrder>[1];
}

const plannedRowsOf = (jobOrderId: string) =>
  runAsTenant(orgId, (tx) =>
    tx.jobOrderStepInputBatch.findMany({
      where: {
        organizationId: orgId,
        stepInput: { step: { jobOrderId } },
        isDeleted: false,
      },
      orderBy: { createdAt: 'asc' },
      include: { batchUnit: { select: { label: true } } },
    }),
  );

beforeAll(async () => {
  orgId = await createTestOrganization('plan-units');

  await runAsTenant(orgId, async (tx) => {
    metreId = (
      await tx.unitOfMeasurement.create({
        data: { organizationId: orgId, unitName: 'Metre', symbol: 'MTR' },
        select: { id: true },
      })
    ).id;

    const make = async (name: string) =>
      (
        await tx.item.create({
          data: {
            organizationId: orgId,
            name,
            sku: `PU-${name}-${unique()}`,
            unit: 'Metre',
            stockingUomId: metreId,
            inventoryTracking: 'batch',
          },
          select: { id: true },
        })
      ).id;

    greyId = await make('Grey');
    dyedId = await make('Dyed');

    godownId = (
      await tx.location.create({
        data: { organizationId: orgId, name: 'Main Godown', type: 'godown' },
        select: { id: true },
      })
    ).id;

    dyerId = (
      await tx.vendor.create({
        data: {
          organizationId: orgId,
          contactName: 'Sunrise Dyers',
          contactNumber: `VEN-${unique()}`,
          vendorTypes: ['job_worker'],
        },
        select: { id: true },
      })
    ).id;
  });

  processId = (await createNewProcess(orgId, { name: 'Dyeing', rateBasis: 'per_issued_unit' })).id;
});

afterAll(async () => {
  await runAsTenant(orgId, async (tx) => {
    await tx.jobOrderStepInputBatch.deleteMany({ where: { organizationId: orgId } });
    await tx.jobOrderStepInput.deleteMany({ where: { organizationId: orgId } });
    await tx.jobOrderStepOutput.deleteMany({ where: { organizationId: orgId } });
    await tx.jobOrderStep.deleteMany({ where: { organizationId: orgId } });
    await tx.jobOrder.deleteMany({ where: { organizationId: orgId } });
    await tx.stockLedgerEntry.deleteMany({ where: { organizationId: orgId } });
    await tx.batchUnit.deleteMany({ where: { organizationId: orgId } });
    await tx.batch.deleteMany({ where: { organizationId: orgId } });
    await tx.process.deleteMany({ where: { organizationId: orgId } });
    await tx.item.deleteMany({ where: { organizationId: orgId } });
    await tx.location.deleteMany({ where: { organizationId: orgId } });
    await tx.vendor.deleteMany({ where: { organizationId: orgId } });
    await tx.unitOfMeasurement.deleteMany({ where: { organizationId: orgId } });
    await tx.numberSequence.deleteMany({ where: { organizationId: orgId } });
  });
  await deleteTestOrganization(orgId);
});

describe('job order planning — naming a package', { timeout: 60_000 }, () => {
  it('records which roll the plan meant, and reads it back', async () => {
    const { batch, units } = await stockWithUnits(1000, [
      { label: 'T-1', qty: 400 },
      { label: 'T-2', qty: 600 },
    ]);

    const order = await createNewJobOrder(
      orgId,
      orderWith(600, [
        { batchId: batch.id, batchUnitId: units[1]!.id, locationId: godownId, qty: 600 },
      ]),
    );

    const rows = await plannedRowsOf(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.batchUnitId).toBe(units[1]!.id);
    expect(rows[0]!.batchUnit?.label).toBe('T-2');
  });

  it('still allows a plan that names the batch and no roll', async () => {
    const { batch } = await stockWithUnits(500, [{ label: 'T-1', qty: 200 }]);

    const order = await createNewJobOrder(
      orgId,
      orderWith(500, [{ batchId: batch.id, locationId: godownId, qty: 500 }]),
    );

    const rows = await plannedRowsOf(order.id);
    // 🔴 Null, not an empty string or a placeholder — it is what every plan
    // written before the level existed means, and it must stay expressible.
    expect(rows[0]!.batchUnitId).toBeNull();
  });

  it('plans several rolls of one batch as several rows', async () => {
    const { batch, units } = await stockWithUnits(900, [
      { label: 'T-1', qty: 300 },
      { label: 'T-2', qty: 300 },
      { label: 'T-3', qty: 300 },
    ]);

    const order = await createNewJobOrder(
      orgId,
      orderWith(600, [
        { batchId: batch.id, batchUnitId: units[0]!.id, locationId: godownId, qty: 300 },
        { batchId: batch.id, batchUnitId: units[2]!.id, locationId: godownId, qty: 300 },
      ]),
    );

    const rows = await plannedRowsOf(order.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.batchUnit?.label).sort()).toEqual(['T-1', 'T-3']);
  });

  it('refuses a roll that is not in the batch beside it', async () => {
    const a = await stockWithUnits(500, [{ label: 'T-1', qty: 500 }]);
    const b = await stockWithUnits(500, [{ label: 'T-1', qty: 500 }]);

    await expect(
      createNewJobOrder(
        orgId,
        orderWith(500, [
          { batchId: b.batch.id, batchUnitId: a.units[0]!.id, locationId: godownId, qty: 500 },
        ]),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('is still only a NOTE — the same roll can be planned by two orders', async () => {
    const { batch, units } = await stockWithUnits(500, [{ label: 'T-1', qty: 500 }]);
    const row = { batchId: batch.id, batchUnitId: units[0]!.id, locationId: godownId, qty: 500 };

    const first = await createNewJobOrder(orgId, orderWith(500, [row]));
    const second = await createNewJobOrder(orgId, orderWith(500, [row]));

    // 🔴 Both stand. Nothing is held back: availability is a ledger query and does
    // not subtract plans, exactly as it does not for a batch. The issue picker
    // WARNS that a roll is spoken for elsewhere; it never refuses it.
    expect((await plannedRowsOf(first.id))[0]!.batchUnitId).toBe(units[0]!.id);
    expect((await plannedRowsOf(second.id))[0]!.batchUnitId).toBe(units[0]!.id);
  });
});

/**
 * 🔴 THE UNIQUE KEY, WHICH A NULLABLE COLUMN QUIETLY BREAKS.
 *
 * `@@unique([jobOrderStepInputId, batchId, locationId, batchUnitId])` is built by
 * hand as `NULLS NOT DISTINCT`, because Postgres's default treats two NULLs as
 * different values — so a plain index would let two UNTAGGED rows for one
 * (input, batch, location) both insert, which is the exact case the constraint
 * exists for and the one every org that never turns the level on will write.
 *
 * The service refuses the duplicate first, by name; the index is what stops a
 * script or an import doing it behind the service's back. Both are checked here.
 */
describe('job order planning — the duplicate guard', { timeout: 60_000 }, () => {
  it('refuses the same batch twice on one row, by name', async () => {
    const { batch } = await stockWithUnits(1000, []);

    await expect(
      createNewJobOrder(
        orgId,
        orderWith(1000, [
          { batchId: batch.id, locationId: godownId, qty: 500 },
          { batchId: batch.id, locationId: godownId, qty: 500 },
        ]),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses the same ROLL twice on one row', async () => {
    const { batch, units } = await stockWithUnits(1000, [{ label: 'T-1', qty: 1000 }]);

    await expect(
      createNewJobOrder(
        orgId,
        orderWith(1000, [
          { batchId: batch.id, batchUnitId: units[0]!.id, locationId: godownId, qty: 500 },
          { batchId: batch.id, batchUnitId: units[0]!.id, locationId: godownId, qty: 500 },
        ]),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('lets one batch be planned once untagged AND once per roll', async () => {
    const { batch, units } = await stockWithUnits(1000, [{ label: 'T-1', qty: 400 }]);

    // Three DIFFERENT things: the roll, and the loose remainder. Both are real
    // and both belong on the plan, so the key must separate them.
    const order = await createNewJobOrder(
      orgId,
      orderWith(1000, [
        { batchId: batch.id, batchUnitId: units[0]!.id, locationId: godownId, qty: 400 },
        { batchId: batch.id, locationId: godownId, qty: 600 },
      ]),
    );

    const rows = await plannedRowsOf(order.id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.batchUnitId === null)).toHaveLength(1);
  });

  it('survives a re-save, because plans are replaced rather than merged', async () => {
    const { batch, units } = await stockWithUnits(1000, [{ label: 'T-1', qty: 1000 }]);

    const order = await createNewJobOrder(
      orgId,
      orderWith(1000, [
        { batchId: batch.id, batchUnitId: units[0]!.id, locationId: godownId, qty: 1000 },
      ]),
    );

    // The same plan again. A soft-deleted row sitting on the key would collide;
    // plans are hard-deleted and re-inserted precisely so it cannot.
    await updateJobOrderById(
      orgId,
      order.id,
      orderWith(1000, [
        { batchId: batch.id, batchUnitId: units[0]!.id, locationId: godownId, qty: 1000 },
      ]) as Parameters<typeof updateJobOrderById>[2],
    );

    const rows = await plannedRowsOf(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.batchUnitId).toBe(units[0]!.id);
  });
});
