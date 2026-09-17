import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { deleteTestOrganization, uniqueOrgCode } from '../../../db/testTenant.ts';
import { createBatch, postMovement } from '../../inventory/stock-ledger/stockLedger.service.ts';
import { SOURCE_DOC_TYPES, runAsDocument } from '../jobwork.types.ts';
import { createNewProcess } from '../processes/processes.service.ts';
import { createNewJobIssue } from '../issues/jobIssues.service.ts';
import { createNewJobReceipt } from '../receipts/jobReceipts.service.ts';
import {
  createNewJobOrder,
  getJobOrderById,
  manuallyCompleteStep,
  updateJobOrderById,
} from './jobOrders.service.ts';

/**
 * A step that has already sent material out is locked — except its processor, which
 * is only the Issue screen's default. Changing it must leave every challan and
 * receipt already raised exactly as it was.
 *
 * Every row is created by this file and hard-deleted afterwards (CLAUDE.md).
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let metreId: string;
let godownId: string;
let dyerA: string;
let dyerB: string;
let dyeingId: string;
let washingId: string;

async function makeItem(name: string) {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name,
        sku: `LP-${name}-${unique()}`,
        unit: 'Metre',
        stockingUomId: metreId,
        inventoryTracking: 'batch',
        trackInventory: true,
      },
      select: { id: true },
    });
    return item.id;
  });
}

async function seedStock(itemId: string, qty: number) {
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
      valueIn: qty * 10,
      sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
      sourceDocId: batch.id,
    });
    return batch;
  });
}

const challan = (id: string) =>
  runAsTenant(orgId, (tx) =>
    tx.jobIssue.findFirstOrThrow({
      where: { id, organizationId: orgId },
      select: { processorId: true, processorNameSnapshot: true, destinationLocationId: true },
    }),
  );

/** One dyeing step at Dyer A with a challan already out — so the step is locked. */
async function lockedRun() {
  const cotton = await makeItem('Cotton');
  const dyed = await makeItem('Dyed');
  const batch = await seedStock(cotton, 1000);
  const order = await createNewJobOrder(orgId, {
    steps: [
      {
        processId: dyeingId,
        processorType: 'vendor',
        processorId: dyerA,
        inputs: [{ itemId: cotton, plannedQty: 1000 }],
        outputs: [{ itemId: dyed, expectedQty: 950, rate: 12 }],
      },
    ],
  });
  const step = order.steps[0]!;
  const first = await createNewJobIssue(orgId, {
    jobOrderStepId: step.id,
    sourceLocationId: godownId,
    lines: [{ itemId: cotton, batchId: batch.id, qty: 400 }],
  });
  return { cotton, dyed, batch, order, step, first };
}

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `locked-processor-${unique()}`, orgCode: uniqueOrgCode() },
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
    godownId = (
      await tx.location.create({
        data: { organizationId: orgId, name: 'Main Godown', type: 'godown' },
        select: { id: true },
      })
    ).id;
    const vendor = (contactName: string) =>
      tx.vendor.create({
        data: {
          organizationId: orgId,
          contactName,
          contactNumber: `VEN-${unique()}`,
          vendorTypes: ['job_worker'],
        },
        select: { id: true },
      });
    dyerA = (await vendor('Dyer A')).id;
    dyerB = (await vendor('Dyer B')).id;
  });

  dyeingId = (await createNewProcess(orgId, { name: `Dyeing ${unique()}` })).id;
  washingId = (await createNewProcess(orgId, { name: `Washing ${unique()}` })).id;
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
    await tx.jobOrderStepOutputComponent.deleteMany({ where: { organizationId: orgId } });
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

describe('a locked step — only the processor may change', { timeout: 120_000 }, () => {
  it('changes the processor, ignores everything else, and leaves raised documents alone', async () => {
    const run = await lockedRun();
    const before = await challan(run.first.id);
    expect(before.processorId).toBe(dyerA);

    const after = await updateJobOrderById(orgId, run.order.id, {
      steps: [
        {
          id: run.step.id,
          processId: washingId, // ignored — locked
          processorType: 'customer', // ignored — locked
          processorId: dyerB,
          inputs: [{ itemId: run.cotton, plannedQty: 5 }], // ignored — locked
          outputs: [{ itemId: run.dyed, expectedQty: 1, rate: 99 }], // ignored — locked
        },
      ],
    });
    const step = after.steps[0]!;
    expect(step.processorId).toBe(dyerB);
    expect(step.processorNameSnapshot).toBe('Dyer B');
    expect(step.processorType).toBe('vendor');
    expect(step.processId).toBe(dyeingId);
    expect(Number(step.inputs[0]!.plannedQty)).toBe(1000);
    expect(Number(step.outputs[0]!.expectedQty)).toBe(950);
    expect(Number(step.outputs[0]!.rate)).toBe(12);

    // The challan already out keeps its own processor and destination.
    expect(await challan(run.first.id)).toEqual(before);

    // The next challan defaults to the new processor…
    const next = await createNewJobIssue(orgId, {
      jobOrderStepId: run.step.id,
      sourceLocationId: godownId,
      lines: [{ itemId: run.cotton, batchId: run.batch.id, qty: 100 }],
    });
    const nextRow = await challan(next.id);
    expect(nextRow.processorId).toBe(dyerB);
    expect(nextRow.destinationLocationId).not.toBe(before.destinationLocationId);

    // …and the old challan is still received from Dyer A.
    const receipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: run.step.id,
      issueIds: [run.first.id],
      locationId: godownId,
      lines: [{ itemId: run.cotton, receivedQty: 0 }],
      outputs: [
        {
          itemId: run.dyed,
          isPrimary: true,
          receivedQty: 380,
          acceptedQty: 380,
          batchReference: `OUT-${unique()}`,
        },
      ],
    });
    expect(receipt.processorId).toBe(dyerA);
  });

  it('leaves the processor alone when the payload does not send one', async () => {
    const run = await lockedRun();
    const after = await updateJobOrderById(orgId, run.order.id, {
      steps: [{ id: run.step.id, processId: dyeingId }],
    });
    expect(after.steps[0]!.processorId).toBe(dyerA);
  });

  it('refuses a processor that does not exist, and changes nothing', async () => {
    const run = await lockedRun();
    await expect(
      updateJobOrderById(orgId, run.order.id, {
        steps: [{ id: run.step.id, processId: dyeingId, processorId: crypto.randomUUID() }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    const order = await getJobOrderById(orgId, run.order.id);
    expect(order!.steps[0]!.processorId).toBe(dyerA);
  });

  it('keeps a completed step’s processor as it was', async () => {
    const run = await lockedRun();
    await manuallyCompleteStep(orgId, run.order.id, run.step.id, undefined);
    const after = await updateJobOrderById(orgId, run.order.id, {
      steps: [{ id: run.step.id, processId: dyeingId, processorId: dyerB }],
    });
    expect(after.steps[0]!.processorId).toBe(dyerA);
  });
});
