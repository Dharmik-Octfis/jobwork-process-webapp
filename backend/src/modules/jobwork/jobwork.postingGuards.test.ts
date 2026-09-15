import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../db/prisma.ts';
import { deleteTestOrganization, uniqueOrgCode } from '../../db/testTenant.ts';
import {
  createBatch,
  getBalance,
  postMovement,
} from '../inventory/stock-ledger/stockLedger.service.ts';
import { SOURCE_DOC_TYPES, runAsDocument } from './jobwork.types.ts';
import { createNewProcess } from './processes/processes.service.ts';
import { createNewJobOrder } from './job-orders/jobOrders.service.ts';
import { cancelJobIssue, createNewJobIssue } from './issues/jobIssues.service.ts';
import { cancelJobReceipt, createNewJobReceipt } from './receipts/jobReceipts.service.ts';

/**
 * 🔴 The two posting bugs the landed-cost plan fixes first (§6.0).
 *
 *   1. A challan whose material a posted receipt already consumed could be
 *      cancelled — the guard summed `received_qty`, which receipts never write —
 *      and the reversal drove the processor's balance negative.
 *   2. Nothing serialised postings on a step, so two receipts posted together
 *      both consumed the same outstanding quantity.
 *
 * Every row here is created by this file and hard-deleted afterwards (CLAUDE.md).
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

async function aStepReadyToReceive(qty: number, value: number) {
  const inputBatch = await seedStock(greyId, qty, value);
  const jobOrder = await createNewJobOrder(orgId, {
    steps: [
      {
        processId,
        processorType: 'vendor',
        processorId: dyerId,
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
  const { destinationLocationId: processorLocationId } = await runAsTenant(orgId, (tx) =>
    tx.jobIssue.findFirstOrThrow({
      where: { id: issue.id, organizationId: orgId },
      select: { destinationLocationId: true },
    }),
  );
  return { step, issue, inputBatch, processorLocationId };
}

const receive = (stepId: string, issueId: string, qty: number) =>
  createNewJobReceipt(orgId, {
    jobOrderStepId: stepId,
    issueIds: [issueId],
    locationId: godownId,
    lines: [{ itemId: greyId, issuedQty: qty, receivedQty: 0 }],
    outputs: [
      {
        itemId: dyedId,
        isPrimary: true,
        receivedQty: qty,
        acceptedQty: qty,
        batchReference: `GUARD-${unique()}`,
      },
    ],
  });

const qtyAt = async (batchId: string, locationId: string) =>
  (
    await runAsTenant(orgId, (tx) => getBalance(tx, { organizationId: orgId, batchId, locationId }))
  ).qty.toString();

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `posting-guards-${unique()}`, orgCode: uniqueOrgCode() },
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
            sku: `PG-${name}-${unique()}`,
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

  processId = (await createNewProcess(orgId, { name: 'Dyeing' })).id;
});

afterAll(async () => {
  if (!orgId) return deleteTestOrganization(orgId);
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

describe('challan cancellation — consumed material', { timeout: 60_000 }, () => {
  it('refuses while a posted receipt has consumed it, and allows it once that receipt is cancelled', async () => {
    const { step, issue, inputBatch, processorLocationId } = await aStepReadyToReceive(1000, 50000);
    const receipt = await receive(step.id, issue.id, 400);

    await expect(cancelJobIssue(orgId, issue.id, 'vehicle turned back')).rejects.toThrow(
      /already been received/i,
    );
    // The refusal reversed nothing: 600 still at the processor, never negative.
    expect(await qtyAt(inputBatch.id, processorLocationId)).toBe('600');

    await cancelJobReceipt(orgId, receipt.id, 'mis-keyed');
    const cancelled = await cancelJobIssue(orgId, issue.id, 'vehicle turned back');

    expect(cancelled.status).toBe('cancelled');
    expect(await qtyAt(inputBatch.id, processorLocationId)).toBe('0');
    expect(await qtyAt(inputBatch.id, godownId)).toBe('1000');
  });
});

describe('posting on one step — serialised', { timeout: 60_000 }, () => {
  it('lets the second of two concurrent receipts see what the first consumed', async () => {
    const { step, issue, inputBatch, processorLocationId } = await aStepReadyToReceive(1000, 50000);

    // Drives two transactions at once on purpose: 600 + 600 against 1,000 out.
    const results = await Promise.allSettled([
      receive(step.id, issue.id, 600),
      receive(step.id, issue.id, 600),
    ]);

    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0]!.reason as Error).message)).toMatch(/outstanding/i);

    expect(await qtyAt(inputBatch.id, processorLocationId)).toBe('400');
  });
});
