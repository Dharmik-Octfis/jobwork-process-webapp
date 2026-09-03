import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { deleteTestOrganization, uniqueOrgCode } from '../../../db/testTenant.ts';
import {
  createBatch,
  getBalance,
  postMovement,
} from '../../inventory/stock-ledger/stockLedger.service.ts';
import { SOURCE_DOC_TYPES, runAsDocument } from '../jobwork.types.ts';
import { createNewProcess } from '../processes/processes.service.ts';
import { createNewJobOrder } from '../job-orders/jobOrders.service.ts';
import { createNewJobIssue } from '../issues/jobIssues.service.ts';
import {
  cancelJobReceipt,
  createNewJobReceipt,
  getOutputBatchOptions,
} from './jobReceipts.service.ts';

/**
 * 🔴 SPLIT AND CONTINUED BATCHES ON A RECEIPT (2026-08-21).
 *
 * Until this change an output row created exactly one accepted batch and one
 * rework batch. Two things were therefore impossible, and both are ordinary:
 *
 *   · a dyer returning THREE dye lots in one consignment — one label across all
 *     three loses the separation the lots were physically kept in;
 *   · the SECOND HALF of a split delivery — 500 m of dye lot 23 today and 500 m
 *     tomorrow could only become two batches with the same label, so a recall on
 *     lot 23 finds half the stock.
 *
 * The tests below are grouped by what they protect, and the ones that matter
 * most are the two nobody would think to write: continuing a batch whose balance
 * has already gone to ZERO (§"the day-two case"), and the cancellation guard,
 * which was wrong in two ways before this change.
 *
 * 🔴 Every row here is created by this file and hard-deleted afterwards. Suites
 * run against the dev database IN PARALLEL, so nothing here reads pre-existing
 * data (CLAUDE.md).
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let greyId: string;
let dyedId: string;
let otherItemId: string;
let metreId: string;
let godownId: string;
let secondGodownId: string;
let dyerId: string;
let processId: string;

/** Stock on the books, written the way Purchase Received will write it. */
async function seedStock(itemId: string, qty: number, value: number, locationId = godownId) {
  return runAsDocument(orgId, async (tx) => {
    const batch = await createBatch(tx, {
      organizationId: orgId,
      itemId,
      ownership: 'own',
      supplierBatchRef: `SEED-${unique()}`,
      sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
    });
    await postMovement(tx, {
      organizationId: orgId,
      batchId: batch.id,
      locationId,
      movementType: 'receipt',
      qtyIn: qty,
      valueIn: value,
      sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
      sourceDocId: batch.id,
    });
    return batch;
  });
}

/**
 * A whole job order with one dyeing step, issued and ready to receive against.
 * Each test gets its own so a receipt in one cannot close a challan in another.
 */
async function aStepReadyToReceive(qty: number, value: number) {
  const inputBatch = await seedStock(greyId, qty, value);
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
        plannedInputQty: qty,
      },
    ],
  });
  const step = jobOrder.steps[0]!;
  const issue = await createNewJobIssue(orgId, {
    jobOrderStepId: step.id,
    sourceLocationId: godownId,
    lines: [{ itemId: greyId, batchId: inputBatch.id, qty }],
  });
  return { jobOrder, step, issue, inputBatch };
}

const balanceOf = (batchId: string, locationId?: string) =>
  runAsTenant(orgId, (tx) => getBalance(tx, { organizationId: orgId, batchId, locationId }));

/** The batches one receipt wrote into, in the order it wrote them. */
const batchRowsOf = (receiptId: string) =>
  runAsTenant(orgId, (tx) =>
    tx.jobReceiptOutputBatch.findMany({
      where: { organizationId: orgId, jobReceiptId: receiptId, isDeleted: false },
      orderBy: [{ kind: 'asc' }, { seq: 'asc' }],
      include: { batch: { select: { supplierBatchRef: true, parentBatchIds: true } } },
    }),
  );

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `receipt-batches-${unique()}`, orgCode: uniqueOrgCode() },
    select: { id: true },
  });
  orgId = org.id;

  await runAsTenant(orgId, async (tx) => {
    const metre = await tx.unitOfMeasurement.create({
      data: { organizationId: orgId, unitName: 'Metre', symbol: 'MTR' },
      select: { id: true },
    });
    metreId = metre.id;

    const make = async (name: string, tracking: string) =>
      (
        await tx.item.create({
          data: {
            organizationId: orgId,
            name,
            sku: `RB-${name}-${unique()}`,
            unit: 'Metre',
            stockingUomId: metreId,
            inventoryTracking: tracking,
          },
          select: { id: true },
        })
      ).id;

    greyId = await make('Grey', 'batch');
    dyedId = await make('Dyed', 'batch');
    otherItemId = await make('Unrelated', 'batch');

    godownId = (
      await tx.location.create({
        data: { organizationId: orgId, name: 'Main Godown', type: 'godown' },
        select: { id: true },
      })
    ).id;
    secondGodownId = (
      await tx.location.create({
        data: { organizationId: orgId, name: 'Packing Store', type: 'godown' },
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
  // Bottom-up: `stock_ledger` holds RESTRICT foreign keys to items, batches and
  // locations, and `job_receipt_output_batches` holds one to batches — so letting
  // the organization cascade would hit those in whatever order Postgres chose.
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
    // Packages before batches — a package points at its batch with a RESTRICT key.
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

describe('receipt — several batches from one delivery', { timeout: 60_000 }, () => {
  it('splits the accepted quantity across two new batches, conserving the value', async () => {
    const { step, issue } = await aStepReadyToReceive(1000, 50000);

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
          batches: [
            { batchReference: 'LOT-A', qty: 600 },
            { batchReference: 'LOT-B', qty: 400 },
          ],
        },
      ],
    });

    const rows = await batchRowsOf(receipt.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.batch.supplierBatchRef)).toEqual(['LOT-A', 'LOT-B']);
    expect(rows.every((row) => row.isNewBatch)).toBe(true);
    // The header's column names the FIRST of them, not the only one.
    expect(receipt.outputBatchId).toBe(rows[0]!.batchId);

    const a = await balanceOf(rows[0]!.batchId);
    const b = await balanceOf(rows[1]!.batchId);
    expect(a.qty.toString()).toBe('600');
    expect(b.qty.toString()).toBe('400');

    /**
     * 🔴 THE CONSERVATION CHECK, and the reason `splitByQty` gives the last part
     * the remainder instead of its own rounded share.
     *
     * The pot is what was consumed (₹50,000) plus the process charge
     * (1,000 × ₹10). Rounding each share independently loses fractions, and the
     * missing paisa is not a display problem — the pot would stop equalling what
     * was posted, so "cost per metre" could never reconcile with the ledger.
     */
    expect(a.value.plus(b.value).toString()).toBe('60000');
  });

  it('keeps rework in its own batch while the accepted goods split across two', async () => {
    const { step, issue } = await aStepReadyToReceive(1000, 50000);

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
          acceptedQty: 900,
          reworkQty: 100,
          batches: [
            { batchReference: 'RW-A', qty: 500 },
            { batchReference: 'RW-B', qty: 400 },
          ],
          reworkBatches: [{ batchReference: 'RW-REDO', qty: 100 }],
        },
      ],
    });

    const rows = await batchRowsOf(receipt.id);
    expect(rows.filter((row) => row.kind === 'accepted')).toHaveLength(2);
    expect(rows.filter((row) => row.kind === 'rework')).toHaveLength(1);
    // The rework batch is a batch of its own — the piece count it has to be
    // measured by is exactly what merging would lose.
    expect(new Set(rows.map((row) => row.batchId)).size).toBe(3);
    expect(receipt.reworkBatchId).toBe(rows.find((row) => row.kind === 'rework')!.batchId);

    const total = await Promise.all(rows.map((row) => balanceOf(row.batchId)));
    expect(
      total
        .reduce((sum, balance) => sum.plus(balance.value), total[0]!.value.minus(total[0]!.value))
        .toString(),
    ).toBe('60000');
  });

  it('still posts a receipt that names no batches at all (the pre-2026-08-21 shape)', async () => {
    const { step, issue } = await aStepReadyToReceive(500, 25000);

    const receipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: step.id,
      issueIds: [issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 500, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 500,
          acceptedQty: 500,
          // No `batches` — one batch under this label takes the whole quantity.
          batchReference: 'LEGACY-1',
        },
      ],
    });

    const rows = await batchRowsOf(receipt.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.batch.supplierBatchRef).toBe('LEGACY-1');
    expect(rows[0]!.qty.toString()).toBe('500');
  });
});

describe('receipt — continuing a batch across deliveries', { timeout: 60_000 }, () => {
  it('adds to a batch an earlier receipt created, rather than cloning its label', async () => {
    const first = await aStepReadyToReceive(1000, 50000);
    const firstReceipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: first.step.id,
      issueIds: [first.issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 500, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 500,
          acceptedQty: 500,
          batchReference: 'DY-23',
        },
      ],
    });
    const dy23 = (await batchRowsOf(firstReceipt.id))[0]!.batchId;

    // The rest of the same dye lot, on a later delivery against the same challan.
    const secondReceipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: first.step.id,
      issueIds: [first.issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 500, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 500,
          acceptedQty: 500,
          batches: [{ batchId: dy23, qty: 500 }],
        },
      ],
    });

    const rows = await batchRowsOf(secondReceipt.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.batchId).toBe(dy23);
    // 🔴 The whole point: no second batch was born.
    expect(rows[0]!.isNewBatch).toBe(false);

    const balance = await balanceOf(dy23);
    expect(balance.qty.toString()).toBe('1000');

    // One label, one batch — so a recall on DY-23 finds all of it.
    const twins = await runAsTenant(orgId, (tx) =>
      tx.batch.count({
        where: { organizationId: orgId, itemId: dyedId, supplierBatchRef: 'DY-23' },
      }),
    );
    expect(twins).toBe(1);
  });

  /**
   * 🔴 THE DAY-TWO CASE, and the reason the picker is scoped by provenance rather
   * than by "what is in this godown".
   *
   * 500 m arrives Monday and is issued onward Wednesday, so the batch sits at
   * ZERO. Friday's other 500 m of the same lot has to be able to continue it —
   * a balance-filtered list would have hidden it precisely when it was wanted,
   * and the operator would have retyped the label and made a twin.
   */
  it('continues a batch whose balance has already gone to zero', async () => {
    const first = await aStepReadyToReceive(1000, 50000);
    const firstReceipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: first.step.id,
      issueIds: [first.issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 500, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 500,
          acceptedQty: 500,
          batchReference: 'DY-99',
        },
      ],
    });
    const dy99 = (await batchRowsOf(firstReceipt.id))[0]!.batchId;

    // Monday's 500 m leaves for the next processor.
    const onwardOrder = await createNewJobOrder(orgId, {
      steps: [
        {
          processId,
          processorType: 'vendor',
          processorId: dyerId,
          inputs: [{ itemId: dyedId }],
          outputs: [{ itemId: otherItemId, isPrimary: true }],
          plannedInputQty: 500,
        },
      ],
    });
    await createNewJobIssue(orgId, {
      jobOrderStepId: onwardOrder.steps[0]!.id,
      sourceLocationId: godownId,
      lines: [{ itemId: dyedId, batchId: dy99, qty: 500 }],
    });
    expect((await balanceOf(dy99, godownId)).qty.toString()).toBe('0');

    // 🔴 It is still on offer. This is the assertion the whole scoping argument
    // comes down to.
    const options = await getOutputBatchOptions(orgId, {
      jobOrderStepId: first.step.id,
      itemId: dyedId,
    });
    expect(options.jobOrderBatches.map((row) => row.batchId)).toContain(dy99);

    // And Friday's half lands in it.
    const secondReceipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: first.step.id,
      issueIds: [first.issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 500, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 500,
          acceptedQty: 500,
          batches: [{ batchId: dy99, qty: 500 }],
        },
      ],
    });
    expect((await batchRowsOf(secondReceipt.id))[0]!.isNewBatch).toBe(false);
    expect((await balanceOf(dy99, godownId)).qty.toString()).toBe('500');
  });

  it('lands in the receipt location even when the batch sits somewhere else', async () => {
    const first = await aStepReadyToReceive(1000, 50000);
    const firstReceipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: first.step.id,
      issueIds: [first.issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 500, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 500,
          acceptedQty: 500,
          batchReference: 'DY-77',
        },
      ],
    });
    const dy77 = (await batchRowsOf(firstReceipt.id))[0]!.batchId;

    // Second delivery unloaded at a DIFFERENT door. One physical lot, two
    // godowns — which is exactly why batch identity does not depend on location.
    await createNewJobReceipt(orgId, {
      jobOrderStepId: first.step.id,
      issueIds: [first.issue.id],
      locationId: secondGodownId,
      lines: [{ itemId: greyId, issuedQty: 500, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 500,
          acceptedQty: 500,
          batches: [{ batchId: dy77, qty: 500 }],
        },
      ],
    });

    expect((await balanceOf(dy77, godownId)).qty.toString()).toBe('500');
    expect((await balanceOf(dy77, secondGodownId)).qty.toString()).toBe('500');
    expect((await balanceOf(dy77)).qty.toString()).toBe('1000');
  });

  it('appends the second delivery’s parents to the batch, without duplicates or self', async () => {
    const first = await aStepReadyToReceive(500, 25000);
    const firstReceipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: first.step.id,
      issueIds: [first.issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 500, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 500,
          acceptedQty: 500,
          batchReference: 'GEN-1',
        },
      ],
    });
    const target = (await batchRowsOf(firstReceipt.id))[0]!.batchId;

    // A SECOND job order, consuming a DIFFERENT input batch, continuing the same
    // output batch. Its parent has to be appended or the trace is incomplete —
    // and a trace cannot be rebuilt from history that was never recorded.
    const second = await aStepReadyToReceive(500, 25000);
    await createNewJobReceipt(orgId, {
      jobOrderStepId: second.step.id,
      issueIds: [second.issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 500, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 500,
          acceptedQty: 500,
          batches: [{ batchId: target, qty: 500 }],
        },
      ],
    });

    const batch = await runAsTenant(orgId, (tx) =>
      tx.batch.findFirstOrThrow({ where: { id: target, organizationId: orgId } }),
    );
    expect(batch.parentBatchIds).toContain(first.inputBatch.id);
    expect(batch.parentBatchIds).toContain(second.inputBatch.id);
    expect(new Set(batch.parentBatchIds).size).toBe(batch.parentBatchIds.length);
    expect(batch.parentBatchIds).not.toContain(target);
  });
});

describe('receipt — what a batch allocation may not do', { timeout: 60_000 }, () => {
  /** A receipt whose only job is to produce one named batch to point at. */
  async function anExistingBatchOf(itemId: string, reference: string) {
    const { step, issue } = await aStepReadyToReceive(200, 10000);
    const receipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: step.id,
      issueIds: [issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 200, receivedQty: 0 }],
      outputs: [
        { itemId, isPrimary: true, receivedQty: 200, acceptedQty: 200, batchReference: reference },
      ],
    });
    return (await batchRowsOf(receipt.id))[0]!.batchId;
  }

  it('refuses a batch that holds a different item', async () => {
    const wrongItemBatch = await anExistingBatchOf(otherItemId, 'WRONG-ITEM');
    const { step, issue } = await aStepReadyToReceive(300, 15000);

    await expect(
      createNewJobReceipt(orgId, {
        jobOrderStepId: step.id,
        issueIds: [issue.id],
        locationId: godownId,
        lines: [{ itemId: greyId, issuedQty: 300, receivedQty: 0 }],
        outputs: [
          {
            itemId: dyedId,
            isPrimary: true,
            receivedQty: 300,
            acceptedQty: 300,
            batches: [{ batchId: wrongItemBatch, qty: 300 }],
          },
        ],
      }),
      // Two items under one batch id makes every quantity read from it a sum of
      // unlike goods.
    ).rejects.toThrow(/different item/i);
  });

  it('refuses a batch belonging to a different party', async () => {
    const customerBatch = await runAsDocument(orgId, (tx) =>
      createBatch(tx, {
        organizationId: orgId,
        itemId: dyedId,
        ownership: 'customer',
        ownerPartyId: crypto.randomUUID(),
        supplierBatchRef: `CUST-${unique()}`,
        sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
      }),
    );
    const { step, issue } = await aStepReadyToReceive(300, 15000);

    await expect(
      createNewJobReceipt(orgId, {
        jobOrderStepId: step.id,
        issueIds: [issue.id],
        locationId: godownId,
        lines: [{ itemId: greyId, issuedQty: 300, receivedQty: 0 }],
        outputs: [
          {
            itemId: dyedId,
            isPrimary: true,
            receivedQty: 300,
            acceptedQty: 300,
            batches: [{ batchId: customerBatch.id, qty: 300 }],
          },
        ],
      }),
      // 🔴 The dangerous one: merging customer-owned inward jobwork into own
      // stock silently converts somebody else's goods into our asset.
    ).rejects.toThrow(/different party/i);
  });

  it('refuses an allocation that does not add up to the accepted quantity', async () => {
    const { step, issue } = await aStepReadyToReceive(300, 15000);

    await expect(
      createNewJobReceipt(orgId, {
        jobOrderStepId: step.id,
        issueIds: [issue.id],
        locationId: godownId,
        lines: [{ itemId: greyId, issuedQty: 300, receivedQty: 0 }],
        outputs: [
          {
            itemId: dyedId,
            isPrimary: true,
            receivedQty: 300,
            acceptedQty: 300,
            // 250, not 300 — the ledger would hold less than the document claims.
            batches: [{ batchReference: 'SHORT', qty: 250 }],
          },
        ],
      }),
      // The message names both figures, so the operator does not have to work out
      // which of the two is wrong.
    ).rejects.toThrow(/accepted batches add up to 250, but 300 was accepted/i);
  });

  it('refuses the same batch on both the accepted and the rework side', async () => {
    const shared = await anExistingBatchOf(dyedId, 'SHARED');
    const { step, issue } = await aStepReadyToReceive(300, 15000);

    await expect(
      createNewJobReceipt(orgId, {
        jobOrderStepId: step.id,
        issueIds: [issue.id],
        locationId: godownId,
        lines: [{ itemId: greyId, issuedQty: 300, receivedQty: 0 }],
        outputs: [
          {
            itemId: dyedId,
            isPrimary: true,
            receivedQty: 300,
            acceptedQty: 200,
            reworkQty: 100,
            batches: [{ batchId: shared, qty: 200 }],
            reworkBatches: [{ batchId: shared, qty: 100 }],
          },
        ],
      }),
      // Merged, the piece count rework has to be measured by is gone, and the
      // re-issue has no way to send back only what failed.
    ).rejects.toThrow(/only appear once|more than once/i);
  });

  it('refuses a batch from another organization', async () => {
    const { step, issue } = await aStepReadyToReceive(300, 15000);

    await expect(
      createNewJobReceipt(orgId, {
        jobOrderStepId: step.id,
        issueIds: [issue.id],
        locationId: godownId,
        lines: [{ itemId: greyId, issuedQty: 300, receivedQty: 0 }],
        outputs: [
          {
            itemId: dyedId,
            isPrimary: true,
            receivedQty: 300,
            acceptedQty: 300,
            batches: [{ batchId: crypto.randomUUID(), qty: 300 }],
          },
        ],
      }),
    ).rejects.toThrow(/no longer exists|another organization/i);
  });
});

describe('receipt — cancellation', { timeout: 60_000 }, () => {
  /**
   * 🔴 THE BUG THAT EXISTED BEFORE THIS CHANGE. The guard read the HEADER's two
   * batch columns, which name the PRIMARY output only — so a receipt returning
   * dyed cloth AND a by-product could be cancelled with the by-product's batch
   * already issued onward, leaving that step holding stock no document explains.
   */
  it('refuses when a BY-PRODUCT’s batch has already been issued onward', async () => {
    const { step, issue } = await aStepReadyToReceive(1000, 50000);
    const receipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: step.id,
      issueIds: [issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 1000, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 900,
          acceptedQty: 900,
          batchReference: 'MAIN',
        },
        {
          itemId: otherItemId,
          receivedQty: 100,
          acceptedQty: 100,
          valueShare: 0,
          batchReference: 'BYPRODUCT',
        },
      ],
    });

    const byProduct = (await batchRowsOf(receipt.id)).find(
      (row) => row.batch.supplierBatchRef === 'BYPRODUCT',
    )!;

    // Issue the by-product onward — the movement the old guard never looked at.
    const onward = await createNewJobOrder(orgId, {
      steps: [
        {
          processId,
          processorType: 'vendor',
          processorId: dyerId,
          inputs: [{ itemId: otherItemId }],
          outputs: [{ itemId: dyedId, isPrimary: true }],
          plannedInputQty: 100,
        },
      ],
    });
    await createNewJobIssue(orgId, {
      jobOrderStepId: onward.steps[0]!.id,
      sourceLocationId: godownId,
      lines: [{ itemId: otherItemId, batchId: byProduct.batchId, qty: 100 }],
    });

    await expect(cancelJobReceipt(orgId, receipt.id, 'wrong delivery')).rejects.toThrow(
      /already been used/i,
    );
  });

  /**
   * 🔴 THE OTHER HALF OF THE SAME FIX. The guard used to ask "has anything other
   * than A RECEIPT touched this batch", which reads a later top-up as no movement
   * at all. It must ask about anything other than THIS receipt — but only about
   * quantity going OUT, or an ordinary top-up would be permanently uncancellable
   * because the batch carries its creator's `produce` forever.
   */
  it('reverses a top-up without disturbing what the first receipt put in', async () => {
    const first = await aStepReadyToReceive(1000, 50000);
    const firstReceipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: first.step.id,
      issueIds: [first.issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 500, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 500,
          acceptedQty: 500,
          batchReference: 'TOPUP',
        },
      ],
    });
    const target = (await batchRowsOf(firstReceipt.id))[0]!.batchId;

    const secondReceipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: first.step.id,
      issueIds: [first.issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 500, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 500,
          acceptedQty: 500,
          batches: [{ batchId: target, qty: 500 }],
        },
      ],
    });
    expect((await balanceOf(target)).qty.toString()).toBe('1000');

    const cancelled = await cancelJobReceipt(orgId, secondReceipt.id, 'mis-keyed');
    expect(cancelled.status).toBe('cancelled');
    // Exactly its own 500 came back out; the first receipt's is untouched.
    expect((await balanceOf(target)).qty.toString()).toBe('500');
  });

  it('refuses to cancel a receipt whose batch a later receipt has consumed', async () => {
    const { step, issue } = await aStepReadyToReceive(500, 25000);
    const receipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: step.id,
      issueIds: [issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 500, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 500,
          acceptedQty: 500,
          batchReference: 'GONE',
        },
      ],
    });
    const produced = (await batchRowsOf(receipt.id))[0]!.batchId;

    const onward = await createNewJobOrder(orgId, {
      steps: [
        {
          processId,
          processorType: 'vendor',
          processorId: dyerId,
          inputs: [{ itemId: dyedId }],
          outputs: [{ itemId: otherItemId, isPrimary: true }],
          plannedInputQty: 500,
        },
      ],
    });
    await createNewJobIssue(orgId, {
      jobOrderStepId: onward.steps[0]!.id,
      sourceLocationId: godownId,
      lines: [{ itemId: dyedId, batchId: produced, qty: 500 }],
    });

    await expect(cancelJobReceipt(orgId, receipt.id, 'too late')).rejects.toThrow(
      /already been used/i,
    );
  });
});

describe('receipt — the batch picker', { timeout: 60_000 }, () => {
  it('splits this job order’s batches from every other batch of the item', async () => {
    const { step, issue } = await aStepReadyToReceive(500, 25000);
    const receipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: step.id,
      issueIds: [issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 500, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 500,
          acceptedQty: 500,
          batchReference: 'PICK-ME',
        },
      ],
    });
    const mine = (await batchRowsOf(receipt.id))[0]!.batchId;

    const plain = await getOutputBatchOptions(orgId, {
      jobOrderStepId: step.id,
      itemId: dyedId,
    });
    expect(plain.jobOrderBatches.map((row) => row.batchId)).toContain(mine);
    // 🔴 And never in both. The second group is "everything that is NOT one of
    // these", so a batch appearing twice would let one delivery be allocated to
    // the same batch on two rows of the grid.
    expect(plain.otherBatches.map((row) => row.batchId)).not.toContain(mine);

    // A batch of the same item from a DIFFERENT job order.
    const elsewhere = await aStepReadyToReceive(200, 10000);
    const otherReceipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: elsewhere.step.id,
      issueIds: [elsewhere.issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 200, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 200,
          acceptedQty: 200,
          batchReference: 'STRANGER',
        },
      ],
    });
    const stranger = (await batchRowsOf(otherReceipt.id))[0]!.batchId;

    /**
     * 🔴 ON OFFER WITH NOTHING TYPED (2026-08-22). It used to take a search, and
     * the cost was that a FIRST receipt — no prior batches of its own — opened
     * the picker on two empty sections and read as a broken screen.
     */
    const listed = await getOutputBatchOptions(orgId, {
      jobOrderStepId: step.id,
      itemId: dyedId,
    });
    expect(listed.otherBatches.map((row) => row.batchId)).toContain(stranger);
    expect(listed.otherBatches.every((row) => row.source === 'other')).toBe(true);

    const searched = await getOutputBatchOptions(orgId, {
      jobOrderStepId: step.id,
      itemId: dyedId,
      search: 'STRANGER',
    });
    expect(searched.otherBatches.map((row) => row.batchId)).toContain(stranger);
    expect(searched.otherBatches.every((row) => row.source === 'other')).toBe(true);

    // 🔴 The search narrows BOTH groups. Filtering only the second put an
    // unfiltered group above a filtered one, which reads as the search failing.
    expect(searched.jobOrderBatches).toHaveLength(0);
  });

  /**
   * 🔴 KEYSET PAGING OVER THE SECOND GROUP. The picker walks it on scroll, so
   * what matters is that the pages TILE — every batch exactly once, none skipped
   * and none repeated. Offset paging is what fails this the moment a batch is
   * created mid-scroll, which is ordinary on a shared dev system.
   */
  it('pages the other-batches group without repeating or dropping a row', async () => {
    const { step, issue } = await aStepReadyToReceive(200, 10000);
    await createNewJobReceipt(orgId, {
      jobOrderStepId: step.id,
      issueIds: [issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 200, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 200,
          acceptedQty: 200,
          batchReference: 'OWN',
        },
      ],
    });

    // A tag shared by all of them, so one search reaches exactly this set and
    // nothing another suite is doing in parallel can join it.
    const tag = `PAGE-${unique()}`;
    const made: string[] = [];
    for (let n = 0; n < 30; n += 1) {
      const batch = await runAsDocument(orgId, (tx) =>
        createBatch(tx, {
          organizationId: orgId,
          itemId: dyedId,
          ownership: 'own',
          supplierBatchRef: `${tag}-${n}`,
          sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
        }),
      );
      made.push(batch.id);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await getOutputBatchOptions(orgId, {
        jobOrderStepId: step.id,
        itemId: dyedId,
        search: tag,
        cursor,
      });
      // Only page one carries the first group; the rest would be a balance query
      // per page for rows the client already holds.
      if (pages > 0) expect(page.jobOrderBatches).toHaveLength(0);
      seen.push(...page.otherBatches.map((row) => row.batchId));
      cursor = page.otherNextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(2); // 30 rows at 25 a page
    expect(new Set(seen).size).toBe(seen.length); // nothing twice
    expect([...seen].sort()).toEqual([...made].sort()); // nothing missed
  });

  it('reports where a batch is, splitting our godowns from the processor', async () => {
    const { step, issue } = await aStepReadyToReceive(1000, 50000);
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
          batchReference: 'WHERE',
        },
      ],
    });
    const produced = (await batchRowsOf(receipt.id))[0]!.batchId;

    // Send 400 of it out to a processor. It is still our stock — at their
    // location (§5.4) — so it must be reported apart, or a single total reads as
    // stock on hand when 400 of it is away.
    const onward = await createNewJobOrder(orgId, {
      steps: [
        {
          processId,
          processorType: 'vendor',
          processorId: dyerId,
          inputs: [{ itemId: dyedId }],
          outputs: [{ itemId: otherItemId, isPrimary: true }],
          plannedInputQty: 400,
        },
      ],
    });
    await createNewJobIssue(orgId, {
      jobOrderStepId: onward.steps[0]!.id,
      sourceLocationId: godownId,
      lines: [{ itemId: dyedId, batchId: produced, qty: 400 }],
    });

    const options = await getOutputBatchOptions(orgId, {
      jobOrderStepId: step.id,
      itemId: dyedId,
    });
    const row = options.jobOrderBatches.find((batch) => batch.batchId === produced)!;

    expect(row.totalQty).toBe('1000');
    expect(row.internalQty).toBe('600');
    expect(row.externalQty).toBe('400');
    expect(row.byLocation.filter((location) => location.isExternal)).toHaveLength(1);
    expect(row.byLocation.find((location) => location.isExternal)!.qty).toBe('400');
  });
});

/**
 * 🔴 TWO ALLOCATIONS, ONE BATCH — the case that decides how the consume loop may
 * be written (2026-09-01).
 *
 * `createJobReceipt` used to ask `getBalance` per allocation: a round trip per row
 * on the transaction's single connection. It now reads every balance in one query
 * and decrements its copy as each consume is posted. Those two are the same thing
 * ONLY because the decrement is there — reading once and pricing every allocation
 * against that one answer is the obvious version of the change, and this is the
 * test that says why it is wrong.
 */
describe('receipt — a second allocation on the same batch', { timeout: 60_000 }, () => {
  it('prices it against what the first one left, not against the opening balance', async () => {
    // 1000 m at 10/m, sent to the dyer on TWO challans of 500 — the SAME batch on
    // both, which is what makes one receipt allocate against it twice.
    const inputBatch = await seedStock(greyId, 1000, 10000);
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
          plannedInputQty: 1000,
        },
      ],
    });
    const step = jobOrder.steps[0]!;
    const first = await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      lines: [{ itemId: greyId, batchId: inputBatch.id, qty: 500 }],
    });
    const second = await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      lines: [{ itemId: greyId, batchId: inputBatch.id, qty: 500 }],
    });
    const dyerLocationId = first.destinationLocationId;

    /* Half of what is at the dyer's is written off before the receipt — a loss at
       the processor. The batch now holds 500 there while the two challans still
       have 1000 outstanding between them, and that gap is what separates the two
       implementations: priced against ONE up-front read both allocations bill at
       10/m and take 10,000 out of a batch that had 5,000 left. */
    await runAsDocument(orgId, (tx) =>
      postMovement(tx, {
        organizationId: orgId,
        batchId: inputBatch.id,
        locationId: dyerLocationId,
        movementType: 'adjustment',
        qtyOut: 500,
        valueOut: 5000,
        sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
        sourceDocId: inputBatch.id,
      }),
    );

    const receipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: step.id,
      issueIds: [first.id, second.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 1000, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 1000,
          acceptedQty: 1000,
          batches: [{ batchReference: `TWO-ALLOC-${unique()}`, qty: 1000 }],
        },
      ],
    });

    const consumes = await runAsTenant(orgId, (tx) =>
      tx.stockLedgerEntry.findMany({
        where: { organizationId: orgId, sourceDocId: receipt.id, movementType: 'consume' },
        orderBy: { createdAt: 'asc' },
        select: { qtyOut: true, valueOut: true },
      }),
    );

    expect(consumes.map((row) => Number(row.qtyOut))).toEqual([500, 500]);
    // The first allocation takes everything the batch was worth; the second finds
    // it empty. Priced against one up-front read this second figure is 5000.
    expect(consumes.map((row) => Number(row.valueOut))).toEqual([5000, 0]);

    // …so the batch is never left owing value it did not have.
    const after = await balanceOf(inputBatch.id, dyerLocationId);
    expect(Number(after.value)).toBe(0);
  });
});
