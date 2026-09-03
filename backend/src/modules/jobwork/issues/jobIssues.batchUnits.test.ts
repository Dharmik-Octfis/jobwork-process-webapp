import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runAsTenant } from '../../../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../../../db/testTenant.ts';
import {
  createBatch,
  createBatchUnits,
  getBalance,
  getBalancesByBatchUnit,
  postMovement,
} from '../../inventory/stock-ledger/stockLedger.service.ts';
import { SOURCE_DOC_TYPES, runAsDocument } from '../jobwork.types.ts';
import { createNewProcess } from '../processes/processes.service.ts';
import { createNewJobOrder } from '../job-orders/jobOrders.service.ts';
import { cancelJobIssue, createNewJobIssue } from './jobIssues.service.ts';
import { createNewJobReceipt } from '../receipts/jobReceipts.service.ts';

/**
 * 🔴 SENDING PACKAGES OUT — the surface that closes the loop.
 *
 * Until this landed, a batch whose rolls covered ALL of its quantity could not be
 * issued at all: `postMovement`'s invariant refuses an untagged outward row that
 * would leave the packages claiming more than the batch holds, and there was no
 * way to name a package on a challan. Correct behaviour, and a dead end.
 *
 * Three things here are the ones that would go wrong silently:
 *
 *   · CANCELLATION carrying `batchUnitId`. Batch balances return perfectly
 *     correct without it, which is exactly what hides the bug — the roll stays at
 *     the processor forever with an untagged surplus beside it at the godown.
 *   · The RECEIPT consuming what a package-wise challan sent. A fully tagged
 *     batch at the processor has nothing untagged to consume, so the consume has
 *     to name the package the issue used or it is refused.
 *   · The UNTAGGED ceiling. An untagged line may take only what no package holds,
 *     and it has to be told so HERE rather than by an invariant it has never seen.
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

/** A batch at the godown, broken into the packages given, with whatever is left
 * over posted as the untagged remainder — the exact shape a Bill or a receipt
 * writes. */
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

/** A job order with one dyeing step, ready to issue against. Its own per test, so
 * a challan in one cannot close a step in another. */
async function aStep(plannedQty: number) {
  const jobOrder = await createNewJobOrder(orgId, {
    steps: [
      {
        processId,
        processorType: 'vendor',
        processorId: dyerId,
        rate: 10,
        rateBasis: 'per_issued_unit',
        inputs: [{ itemId: greyId }],
        outputs: [{ itemId: dyedId, isPrimary: true }],
        plannedInputQty: plannedQty,
      },
    ],
  });
  return jobOrder.steps[0]!;
}

const balanceOf = (batchId: string, locationId?: string) =>
  runAsTenant(orgId, (tx) => getBalance(tx, { organizationId: orgId, batchId, locationId }));

/** Every package of a batch and its balance at one location, plus the untagged
 * remainder under the `null` key. */
const unitsAt = (batchId: string, locationId: string) =>
  runAsTenant(orgId, async (tx) =>
    (
      await getBalancesByBatchUnit(tx, { organizationId: orgId, batchIds: [batchId], locationId })
    ).get(batchId),
  );

/** Where the goods went — the processor's own location, auto-provisioned by the
 * first challan raised to them. */
const dyerLocationId = () =>
  runAsTenant(orgId, async (tx) => {
    const row = await tx.location.findFirstOrThrow({
      where: { organizationId: orgId, vendorId: dyerId, type: 'processor', isDeleted: false },
      select: { id: true },
    });
    return row.id;
  });

beforeAll(async () => {
  orgId = await createTestOrganization('issue-units');

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
            sku: `IU-${name}-${unique()}`,
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
    await tx.jobReceiptOutputBatch.deleteMany({ where: { organizationId: orgId } });
    await tx.jobReceiptLine.deleteMany({ where: { organizationId: orgId } });
    await tx.jobReceiptOutput.deleteMany({ where: { organizationId: orgId } });
    await tx.jobReceipt.deleteMany({ where: { organizationId: orgId } });
    await tx.jobIssueLine.deleteMany({ where: { organizationId: orgId } });
    await tx.jobIssue.deleteMany({ where: { organizationId: orgId } });
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

describe('issue — sending named packages', { timeout: 60_000 }, () => {
  it('sends a package whole, and moves exactly that package', async () => {
    const { batch, units } = await stockWithUnits(1000, [
      { label: 'T-1', qty: 400 },
      { label: 'T-2', qty: 600 },
    ]);
    const step = await aStep(1000);

    const issue = await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      lines: [{ itemId: greyId, batchId: batch.id, batchUnitId: units[0]!.id, qty: 400 }],
    });

    const dyer = await dyerLocationId();
    const atGodown = (await unitsAt(batch.id, godownId))!;
    const atDyer = (await unitsAt(batch.id, dyer))!;

    // T-1 left; T-2 did not.
    expect(atGodown.get(units[0]!.id)!.toString()).toBe('0');
    expect(atGodown.get(units[1]!.id)!.toString()).toBe('600');
    expect(atDyer.get(units[0]!.id)!.toString()).toBe('400');
    // 🔴 And nothing leaked into the untagged pool at either end — an untagged
    // row here would be a roll the next document has no way to name.
    expect(atGodown.get(null)).toBeUndefined();
    expect(atDyer.get(null)).toBeUndefined();

    // The line records which package it sent, so the receipt can consume it.
    const line = await runAsTenant(orgId, (tx) =>
      tx.jobIssueLine.findFirstOrThrow({ where: { organizationId: orgId, jobIssueId: issue.id } }),
    );
    expect(line.batchUnitId).toBe(units[0]!.id);
  });

  it('sends several packages of one batch as several lines', async () => {
    const { batch, units } = await stockWithUnits(900, [
      { label: 'T-1', qty: 300 },
      { label: 'T-2', qty: 300 },
      { label: 'T-3', qty: 300 },
    ]);
    const step = await aStep(900);

    const issue = await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      lines: [
        { itemId: greyId, batchId: batch.id, batchUnitId: units[0]!.id, qty: 300 },
        { itemId: greyId, batchId: batch.id, batchUnitId: units[2]!.id, qty: 300 },
      ],
    });

    const lines = await runAsTenant(orgId, (tx) =>
      tx.jobIssueLine.findMany({ where: { organizationId: orgId, jobIssueId: issue.id } }),
    );
    // 🔴 Three packages of one batch are three lines, exactly as three batches
    // are — one line carrying two rolls could not say which came back.
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((l) => l.batchUnitId))).toEqual(new Set([units[0]!.id, units[2]!.id]));
    expect((await balanceOf(batch.id, godownId)).qty.toString()).toBe('300');
  });

  /**
   * 🔴 PART OF A ROLL IS A REAL ANSWER (plan §11, decided 2026-09-02).
   *
   * A package was atomic first — pick it and the whole roll goes — on the
   * reasoning that the roll physically travels to the processor. That is true of
   * a full roll and wrong of every part-used one, which is exactly the roll an
   * operator sends the remainder of. The quantity is typed and checked against
   * what the package still holds.
   */
  it('sends part of a package, leaving the rest where it is', async () => {
    const { batch, units } = await stockWithUnits(1000, [{ label: 'T-1', qty: 1000 }]);
    const step = await aStep(1000);

    await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      lines: [{ itemId: greyId, batchId: batch.id, batchUnitId: units[0]!.id, qty: 400 }],
    });

    const dyer = await dyerLocationId();
    // 600 of T-1 is still on the shelf, and it is still T-1 — not an untagged
    // remnant nobody can trace back to the roll.
    expect((await unitsAt(batch.id, godownId))!.get(units[0]!.id)!.toString()).toBe('600');
    expect((await unitsAt(batch.id, dyer))!.get(units[0]!.id)!.toString()).toBe('400');
    expect((await unitsAt(batch.id, godownId))!.get(null)).toBeUndefined();
  });

  it('refuses more than a package holds', async () => {
    const { batch, units } = await stockWithUnits(500, [{ label: 'T-1', qty: 500 }]);
    const step = await aStep(1000);

    await expect(
      createNewJobIssue(orgId, {
        jobOrderStepId: step.id,
        sourceLocationId: godownId,
        lines: [{ itemId: greyId, batchId: batch.id, batchUnitId: units[0]!.id, qty: 501 }],
      }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('T-1') });

    expect((await balanceOf(batch.id, godownId)).qty.toString()).toBe('500');
  });

  /** 🔴 Each line fits on its own; together they overdraw the roll. That is why
   * the guard sums ACROSS lines rather than checking each one. */
  it('refuses two lines that together take more of one package than it holds', async () => {
    const { batch, units } = await stockWithUnits(500, [{ label: 'T-1', qty: 500 }]);
    const step = await aStep(1000);

    await expect(
      createNewJobIssue(orgId, {
        jobOrderStepId: step.id,
        sourceLocationId: godownId,
        lines: [
          { itemId: greyId, batchId: batch.id, batchUnitId: units[0]!.id, qty: 300 },
          { itemId: greyId, batchId: batch.id, batchUnitId: units[0]!.id, qty: 300 },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect((await balanceOf(batch.id, godownId)).qty.toString()).toBe('500');
  });

  it('refuses a package that is not in the named batch', async () => {
    const a = await stockWithUnits(500, [{ label: 'T-1', qty: 500 }]);
    const b = await stockWithUnits(500, [{ label: 'T-1', qty: 500 }]);
    const step = await aStep(1000);

    await expect(
      createNewJobIssue(orgId, {
        jobOrderStepId: step.id,
        sourceLocationId: godownId,
        lines: [{ itemId: greyId, batchId: b.batch.id, batchUnitId: a.units[0]!.id, qty: 500 }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('issue — the untagged remainder', { timeout: 60_000 }, () => {
  it('lets an untagged line take exactly what no package holds, and no more', async () => {
    const { batch } = await stockWithUnits(1000, [{ label: 'T-1', qty: 600 }]);
    const step = await aStep(1000);

    // 400 is loose, so 400 may go without naming a roll.
    await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      lines: [{ itemId: greyId, batchId: batch.id, qty: 400 }],
    });
    expect((await balanceOf(batch.id, godownId)).qty.toString()).toBe('600');

    const step2 = await aStep(1000);
    await expect(
      createNewJobIssue(orgId, {
        jobOrderStepId: step2.id,
        sourceLocationId: godownId,
        lines: [{ itemId: greyId, batchId: batch.id, qty: 1 }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  /**
   * 🔴 THE GAP THIS SURFACE EXISTS TO CLOSE.
   *
   * A batch whose packages cover all of it has nothing untagged, so before the
   * picker could name one there was no way to issue it at all — the invariant
   * refused every line, correctly, and the screen offered no alternative.
   */
  it('issues a fully-tagged batch, which was impossible before packages could be picked', async () => {
    const { batch, units } = await stockWithUnits(700, [
      { label: 'T-1', qty: 300 },
      { label: 'T-2', qty: 400 },
    ]);
    const step = await aStep(700);

    // Untagged is refused, and says why rather than reporting missing stock.
    await expect(
      createNewJobIssue(orgId, {
        jobOrderStepId: step.id,
        sourceLocationId: godownId,
        lines: [{ itemId: greyId, batchId: batch.id, qty: 700 }],
      }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('units') });

    // Naming the packages sends the same goods.
    await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      lines: [
        { itemId: greyId, batchId: batch.id, batchUnitId: units[0]!.id, qty: 300 },
        { itemId: greyId, batchId: batch.id, batchUnitId: units[1]!.id, qty: 400 },
      ],
    });
    expect((await balanceOf(batch.id, godownId)).qty.toString()).toBe('0');
  });

  it('leaves a batch with no packages behaving exactly as it always did', async () => {
    const { batch } = await stockWithUnits(500, []);
    const step = await aStep(500);

    await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      lines: [{ itemId: greyId, batchId: batch.id, qty: 500 }],
    });

    expect((await balanceOf(batch.id, godownId)).qty.toString()).toBe('0');
  });
});

describe('issue — cancellation', { timeout: 60_000 }, () => {
  it('returns the package to the godown, not an untagged quantity', async () => {
    const { batch, units } = await stockWithUnits(1000, [
      { label: 'T-1', qty: 400 },
      { label: 'T-2', qty: 600 },
    ]);
    const step = await aStep(1000);

    const issue = await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      lines: [{ itemId: greyId, batchId: batch.id, batchUnitId: units[0]!.id, qty: 400 }],
    });

    await cancelJobIssue(orgId, issue.id, 'vehicle turned back');

    const dyer = await dyerLocationId();
    const atGodown = (await unitsAt(batch.id, godownId))!;
    const atDyer = (await unitsAt(batch.id, dyer))!;

    /**
     * 🔴 THE ASSERTION THIS FILE EXISTS FOR.
     *
     * The batch balance returns to 1000 at the godown whether or not the reversals
     * carried `batchUnitId` — which is exactly what makes the bug invisible. T-1
     * has to be back at 400, and NOTHING may be sitting in the untagged pool:
     * without the column the roll stays at the dyer's forever and an untagged 400
     * appears at the godown that no document can account for.
     */
    expect(atGodown.get(units[0]!.id)!.toString()).toBe('400');
    expect(atGodown.get(units[1]!.id)!.toString()).toBe('600');
    expect(atGodown.get(null)).toBeUndefined();
    expect(atDyer.get(units[0]!.id)!.toString()).toBe('0');
    expect((await balanceOf(batch.id, godownId)).qty.toString()).toBe('1000');
  });
});

/**
 * 🔴 THE HAND-OFF TO THE RECEIPT, which is where a package-wise issue would
 * otherwise dead-end.
 *
 * A challan that sends a whole roll leaves the batch FULLY tagged at the
 * processor. An untagged consume against it is then refused by the invariant — so
 * the consume has to take the material back out of the package the issue used.
 */
describe('issue → receipt, package-wise', { timeout: 60_000 }, () => {
  it('consumes out of the package the challan sent', async () => {
    const { batch, units } = await stockWithUnits(1000, [{ label: 'T-1', qty: 1000 }]);
    const step = await aStep(1000);

    const issue = await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      lines: [{ itemId: greyId, batchId: batch.id, batchUnitId: units[0]!.id, qty: 1000 }],
    });

    // Nothing untagged is at the dyer's, so this receipt is only possible because
    // the consume names the package.
    const receipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: step.id,
      issueIds: [issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 1000, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 1000,
          acceptedQty: 1000,
          batches: [{ batchReference: 'DYED-1', qty: 1000, units: [{ label: 'D-1', qty: 1000 }] }],
        },
      ],
    });

    const dyer = await dyerLocationId();
    const atDyer = (await unitsAt(batch.id, dyer))!;
    // The roll was consumed at the processor and is gone from there.
    expect(atDyer.get(units[0]!.id)!.toString()).toBe('0');
    expect(atDyer.get(null)).toBeUndefined();

    // …and what came back is its own batch, with its own roll.
    const outputBatchId = await runAsTenant(
      orgId,
      async (tx) =>
        (
          await tx.jobReceiptOutputBatch.findFirstOrThrow({
            where: { organizationId: orgId, jobReceiptId: receipt.id, isDeleted: false },
          })
        ).batchId,
    );
    const dyedUnits = (await unitsAt(outputBatchId, godownId))!;
    expect([...dyedUnits.values()].map((q) => q.toString())).toEqual(['1000']);
  });

  it('consumes only part of a package when only part came back', async () => {
    const { batch, units } = await stockWithUnits(1000, [{ label: 'T-1', qty: 1000 }]);
    const step = await aStep(1000);

    const issue = await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      lines: [{ itemId: greyId, batchId: batch.id, batchUnitId: units[0]!.id, qty: 1000 }],
    });

    await createNewJobReceipt(orgId, {
      jobOrderStepId: step.id,
      issueIds: [issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 600, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 600,
          acceptedQty: 600,
          batches: [{ batchReference: 'DYED-2', qty: 600 }],
        },
      ],
    });

    const dyer = await dyerLocationId();
    const atDyer = (await unitsAt(batch.id, dyer))!;
    /* 🔴 A PARTIAL consume of a package is legal and stays legal: taking quantity
       out of a roll lowers both sides of the invariant equally, so the 400 still
       at the dyer's remains that roll's — not an untagged remnant nobody can
       trace back to it. */
    expect(atDyer.get(units[0]!.id)!.toString()).toBe('400');
    expect(atDyer.get(null)).toBeUndefined();
  });
});
