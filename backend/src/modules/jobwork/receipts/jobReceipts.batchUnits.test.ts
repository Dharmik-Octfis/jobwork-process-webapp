import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { deleteTestOrganization, uniqueOrgCode } from '../../../db/testTenant.ts';
import {
  createBatch,
  getBalance,
  getBalancesByBatchUnit,
  postMovement,
} from '../../inventory/stock-ledger/stockLedger.service.ts';
import { SOURCE_DOC_TYPES, runAsDocument } from '../jobwork.types.ts';
import { createNewProcess } from '../processes/processes.service.ts';
import { createNewJobOrder } from '../job-orders/jobOrders.service.ts';
import { createNewJobIssue } from '../issues/jobIssues.service.ts';
import { cancelJobReceipt, createNewJobReceipt } from './jobReceipts.service.ts';

/**
 * 🔴 THE LEVEL BELOW A BATCH, ON THE SURFACE THAT CREATES IT.
 *
 * A processor hands back rolls, not a quantity. Naming them at the gate is the
 * only moment anybody can — nobody re-measures a bale afterwards — so this is
 * where packages come into existence for everything downstream to pick.
 *
 * Two of these tests are the ones nobody would think to write and are the whole
 * reason the file exists:
 *
 *   · CANCELLATION carrying `batchUnitId` on its reversals. Drop it and batch
 *     balances come back perfectly correct while every package this receipt made
 *     keeps its quantity forever, with an untagged negative beside it. No error,
 *     no warning, nothing on any screen looks wrong.
 *   · A cancelled TOP-UP freeing its package labels again, so re-entering the
 *     receipt is not blocked by "T-4 already exists in this batch".
 *
 * 🔴 Every row here is created by this file and hard-deleted afterwards. Suites
 * run against the dev database IN PARALLEL, so nothing here reads pre-existing
 * data (CLAUDE.md).
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let greyId: string;
let dyedId: string;
let metreId: string;
let godownId: string;
let dyerId: string;
let processId: string;

async function seedStock(itemId: string, qty: number, value: number) {
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
      locationId: godownId,
      movementType: 'receipt',
      qtyIn: qty,
      valueIn: value,
      sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
      sourceDocId: batch.id,
    });
    return batch;
  });
}

/** A whole job order with one dyeing step, issued and ready to receive against.
 * Each test gets its own, so a receipt in one cannot close a challan in another. */
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

/** Every package of a batch and its balance, plus the untagged remainder under
 * the `null` key — the shape every picker reads. */
const unitsOf = (batchId: string) =>
  runAsTenant(orgId, async (tx) =>
    (await getBalancesByBatchUnit(tx, { organizationId: orgId, batchIds: [batchId] })).get(batchId),
  );

const batchIdOf = (receiptId: string) =>
  runAsTenant(orgId, async (tx) => {
    const row = await tx.jobReceiptOutputBatch.findFirstOrThrow({
      where: { organizationId: orgId, jobReceiptId: receiptId, isDeleted: false },
      orderBy: { seq: 'asc' },
    });
    return row.batchId;
  });

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `receipt-units-${unique()}`, orgCode: uniqueOrgCode() },
    select: { id: true },
  });
  orgId = org.id;

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
            sku: `RU-${name}-${unique()}`,
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

describe('receipt — naming the packages that came back', { timeout: 60_000 }, () => {
  it('creates a package per roll and posts one produce each, conserving the value', async () => {
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
            {
              batchReference: 'LOT-A',
              qty: 1000,
              units: [
                { label: 'T-1', qty: 400 },
                { label: 'T-2', qty: 600 },
              ],
            },
          ],
        },
      ],
    });

    const batchId = await batchIdOf(receipt.id);
    const byUnit = (await unitsOf(batchId))!;

    // Two packages, fully tagged — so no untagged remainder at all.
    expect([...byUnit.values()].map((q) => q.toString()).sort()).toEqual(['400', '600']);
    expect(byUnit.get(null)).toBeUndefined();

    const balance = await balanceOf(batchId);
    expect(balance.qty.toString()).toBe('1000');

    /**
     * 🔴 THE CONSERVATION CHECK, one level lower than the batch one.
     *
     * The pot is what was consumed (₹50,000) plus the process charge
     * (1,000 × ₹10). Splitting it again across the packages must not lose a
     * paisa — a package carries no value of its own, it inherits its batch's
     * weighted average, and this is what keeps that true.
     */
    expect(balance.value.toString()).toBe('60000');
  });

  /**
   * 🔴 PARTIAL TAGGING IS NO LONGER LEGAL (2026-09-02). This asserted the
   * opposite until then — 300 tagged of 1000 posted a 700 untagged remainder and
   * passed. The rule is now an equality: name every roll or name none.
   */
  it('refuses a batch whose rolls account for only part of what came back', async () => {
    const { step, issue } = await aStepReadyToReceive(1000, 50000);

    await expect(
      createNewJobReceipt(orgId, {
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
            batches: [{ batchReference: 'LOT-B', qty: 1000, units: [{ label: 'T-1', qty: 300 }] }],
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('still accepts a batch that names NO rolls — the level stays optional', async () => {
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
          batches: [{ batchReference: 'LOT-B', qty: 1000 }],
        },
      ],
    });

    const byUnit = (await unitsOf(await batchIdOf(receipt.id)))!;
    expect(byUnit.get(null)!.toString()).toBe('1000');
    expect((await balanceOf(await batchIdOf(receipt.id))).value.toString()).toBe('60000');
  });

  it('gives accepted and rework packages of their own, in different batches', async () => {
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
          batches: [{ batchReference: 'OK', qty: 900, units: [{ label: 'T-1', qty: 900 }] }],
          reworkBatches: [
            { batchReference: 'REDO', qty: 100, units: [{ label: 'R-1', qty: 100 }] },
          ],
        },
      ],
    });

    const rows = await runAsTenant(orgId, (tx) =>
      tx.jobReceiptOutputBatch.findMany({
        where: { organizationId: orgId, jobReceiptId: receipt.id, isDeleted: false },
        orderBy: [{ kind: 'asc' }, { seq: 'asc' }],
      }),
    );
    expect(rows).toHaveLength(2);

    // 🔴 Rework keeps a batch of its own, so its packages do too — the re-issue
    // has to be able to send back only the pieces that failed.
    for (const row of rows) {
      const byUnit = (await unitsOf(row.batchId))!;
      expect([...byUnit.keys()].filter(Boolean)).toHaveLength(1);
    }
  });

  it('refuses packages that add up to more than came back into the batch', async () => {
    const { step, issue } = await aStepReadyToReceive(1000, 50000);

    await expect(
      createNewJobReceipt(orgId, {
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
              {
                batchReference: 'LOT-C',
                qty: 1000,
                units: [
                  { label: 'T-1', qty: 700 },
                  { label: 'T-2', qty: 700 },
                ],
              },
            ],
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses two packages of one batch sharing a label', async () => {
    const { step, issue } = await aStepReadyToReceive(1000, 50000);

    await expect(
      createNewJobReceipt(orgId, {
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
              {
                batchReference: 'LOT-D',
                qty: 1000,
                units: [
                  { label: 'T-1', qty: 500 },
                  { label: 't-1', qty: 500 },
                ],
              },
            ],
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('receipt — a top-up brings MORE rolls, not corrections', { timeout: 60_000 }, () => {
  it('continues the batch’s own numbering across two deliveries', async () => {
    const { step, issue } = await aStepReadyToReceive(1000, 50000);

    const first = await createNewJobReceipt(orgId, {
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
          batches: [
            {
              batchReference: 'LOT-23',
              qty: 500,
              units: [
                { label: 'T-1', qty: 250 },
                { label: 'T-2', qty: 250 },
              ],
            },
          ],
        },
      ],
    });
    const batchId = await batchIdOf(first.id);

    await createNewJobReceipt(orgId, {
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
          // The SAME batch, three more rolls into it.
          batches: [{ batchId, qty: 500, units: [{ label: 'T-3', qty: 500 }] }],
        },
      ],
    });

    const units = await runAsTenant(orgId, (tx) =>
      tx.batchUnit.findMany({
        where: { organizationId: orgId, batchId, isDeleted: false },
        orderBy: { seq: 'asc' },
        select: { seq: true, label: true },
      }),
    );

    // 🔴 seq 1, 2, 3 — continued, not restarted. Two rolls both called "1" could
    // not be told apart on the goods, which is the only place the label exists.
    expect(units).toEqual([
      { seq: 1, label: 'T-1' },
      { seq: 2, label: 'T-2' },
      { seq: 3, label: 'T-3' },
    ]);
    expect((await balanceOf(batchId)).qty.toString()).toBe('1000');
  });
});

describe('receipt — cancellation', { timeout: 60_000 }, () => {
  it('reverses the packages, not just the batch', async () => {
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
            {
              batchReference: 'LOT-X',
              qty: 1000,
              // Accounts for the whole batch — partial tagging is refused since
              // 2026-09-02, and this test is about the reversal, not the rule.
              units: [
                { label: 'T-1', qty: 400 },
                { label: 'T-2', qty: 600 },
              ],
            },
          ],
        },
      ],
    });
    const batchId = await batchIdOf(receipt.id);

    await cancelJobReceipt(orgId, receipt.id, 'wrong consignment');

    const balance = await balanceOf(batchId);
    expect(balance.qty.toString()).toBe('0');

    /**
     * 🔴 THE ASSERTION THIS WHOLE FILE EXISTS FOR.
     *
     * The batch balance above returns to zero whether or not the reversals carried
     * `batchUnitId` — that is exactly what makes the bug invisible. Every package
     * has to come back to zero TOO, and no quantity may be left sitting under the
     * untagged key, or T-1 keeps its 400 forever with a −700 beside it and nothing
     * anywhere says so.
     */
    const byUnit = (await unitsOf(batchId))!;
    for (const [, qty] of byUnit) expect(qty.toString()).toBe('0');
  });

  it('frees the package labels a cancelled top-up used, so it can be re-entered', async () => {
    const { step, issue } = await aStepReadyToReceive(1000, 50000);

    const first = await createNewJobReceipt(orgId, {
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
          batches: [{ batchReference: 'LOT-Y', qty: 500, units: [{ label: 'T-1', qty: 500 }] }],
        },
      ],
    });
    const batchId = await batchIdOf(first.id);

    const second = await createNewJobReceipt(orgId, {
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
          batches: [{ batchId, qty: 500, units: [{ label: 'T-2', qty: 500 }] }],
        },
      ],
    });

    await cancelJobReceipt(orgId, second.id, 'delivered to the wrong godown');

    /* 🔴 A package label is unique inside its batch, unlike a batch reference. So
       a cancelled top-up MUST give its labels back, or re-entering the receipt
       hits "T-2 already exists in this batch" and the user is stuck with no way
       to say what they meant. */
    const live = await runAsTenant(orgId, (tx) =>
      tx.batchUnit.findMany({
        where: { organizationId: orgId, batchId, isDeleted: false },
        select: { label: true },
      }),
    );
    expect(live.map((u) => u.label)).toEqual(['T-1']);

    // And the same labels go straight back on.
    await createNewJobReceipt(orgId, {
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
          batches: [{ batchId, qty: 500, units: [{ label: 'T-2', qty: 500 }] }],
        },
      ],
    });

    expect((await balanceOf(batchId)).qty.toString()).toBe('1000');
  });

  /**
   * 🔴 NOT ABOUT PACKAGES — but found here, and fixed in the same commit.
   *
   * `closedQtyByIssueLine` counted every receipt line ever written, cancelled
   * ones included. So cancelling a receipt reversed its stock and reopened its
   * challans, then left them permanently un-receivable: the challan showed as
   * `partially_received` with ZERO outstanding, and receiving the same goods
   * again was refused with "N more is being received than these challans still
   * have outstanding."
   *
   * A cancellation is the document saying it never happened. The stock, the
   * challan's status and the quantity it has left to account for all have to
   * agree about that, and this was the one that did not.
   */
  it('gives a cancelled receipt’s quantity back to its challan', async () => {
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
          batches: [{ batchReference: 'FIRST-TRY', qty: 1000 }],
        },
      ],
    });

    await cancelJobReceipt(orgId, receipt.id, 'entered against the wrong step');

    // The whole 1000 is outstanding again, so the same goods can be received.
    const second = await createNewJobReceipt(orgId, {
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
          batches: [{ batchReference: 'SECOND-TRY', qty: 1000 }],
        },
      ],
    });

    expect((await balanceOf(await batchIdOf(second.id))).qty.toString()).toBe('1000');
  });

  it('leaves the FIRST receipt’s packages alone when a later one is cancelled', async () => {
    const { step, issue } = await aStepReadyToReceive(1000, 50000);

    const first = await createNewJobReceipt(orgId, {
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
          batches: [{ batchReference: 'LOT-Z', qty: 500, units: [{ label: 'T-1', qty: 500 }] }],
        },
      ],
    });
    const batchId = await batchIdOf(first.id);
    const firstUnit = await runAsTenant(orgId, (tx) =>
      tx.batchUnit.findFirstOrThrow({ where: { organizationId: orgId, batchId } }),
    );

    const second = await createNewJobReceipt(orgId, {
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
          batches: [{ batchId, qty: 500, units: [{ label: 'T-2', qty: 500 }] }],
        },
      ],
    });

    await cancelJobReceipt(orgId, second.id, 'miscounted');

    // The first delivery's roll is untouched: it belongs to a receipt that still
    // stands, and cancelling a later one may not reach into it.
    const byUnit = (await unitsOf(batchId))!;
    expect(byUnit.get(firstUnit.id)!.toString()).toBe('500');
    expect((await balanceOf(batchId)).qty.toString()).toBe('500');
  });
});
