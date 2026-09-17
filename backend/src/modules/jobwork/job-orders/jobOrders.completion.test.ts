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
import { cancelJobIssue, createNewJobIssue } from '../issues/jobIssues.service.ts';
import { createNewJobReceipt } from '../receipts/jobReceipts.service.ts';
import {
  createNewJobOrder,
  getJobOrderOverview,
  manuallyCompleteStep,
  shortCloseJobOrder,
} from './jobOrders.service.ts';

/**
 * 🔴 Completing a step writes off what is still at the processor
 * (docs/JOBWORK_LANDED_COST_PLAN.md R8, R9; §8 tests 3, 4, 13, 15, 17).
 *
 * Every row is created by this file and hard-deleted afterwards (CLAUDE.md).
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let metreId: string;
let godownId: string;
let dyerId: string;
let customerId: string;
let processId: string;

async function makeItem(name: string) {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name,
        sku: `WO-${name}-${unique()}`,
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

async function seedStock(itemId: string, qty: number, valuePerUnit: number, owner?: string) {
  return runAsDocument(orgId, async (tx) => {
    const batch = await createBatch(tx, {
      organizationId: orgId,
      itemId,
      ownership: owner ? 'customer' : 'own',
      ownerPartyId: owner ?? null,
      supplierBatchRef: `SEED-${unique()}`,
      sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
    });
    await postMovement(tx, {
      organizationId: orgId,
      batchId: batch.id,
      locationId: godownId,
      movementType: 'receipt',
      qtyIn: qty,
      valueIn: qty * valuePerUnit,
      sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
      sourceDocId: batch.id,
    });
    return batch;
  });
}

type Row = { itemId: string; plannedQty?: number; expectedQty?: number; rate?: number };

async function order(steps: { inputs: Row[]; outputs: Row[] }[], owner?: string) {
  const jo = await createNewJobOrder(orgId, {
    ownership: owner ? 'customer' : 'own',
    ownerPartyId: owner ?? null,
    steps: steps.map((step) => ({
      processId,
      processorType: 'vendor' as const,
      processorId: dyerId,
      ...step,
    })),
  });
  return { jobOrderId: jo.id, stepIds: jo.steps.map((step) => step.id) };
}

async function issue(stepId: string, itemId: string, batchId: string, qty: number) {
  const challan = await createNewJobIssue(orgId, {
    jobOrderStepId: stepId,
    sourceLocationId: godownId,
    lines: [{ itemId, batchId, qty }],
  });
  const { destinationLocationId } = await runAsTenant(orgId, (tx) =>
    tx.jobIssue.findFirstOrThrow({
      where: { id: challan.id, organizationId: orgId },
      select: { destinationLocationId: true },
    }),
  );
  return { id: challan.id, processorLocationId: destinationLocationId };
}

const receive = (
  stepId: string,
  issueIds: string[],
  inputItemId: string,
  outputItemId: string,
  accepted: number,
  mode: 'post' | 'draft' = 'post',
) =>
  createNewJobReceipt(
    orgId,
    {
      jobOrderStepId: stepId,
      issueIds,
      locationId: godownId,
      lines: [{ itemId: inputItemId, receivedQty: 0 }],
      outputs: [
        {
          itemId: outputItemId,
          isPrimary: true,
          receivedQty: accepted,
          acceptedQty: accepted,
          batchReference: `OUT-${unique()}`,
        },
      ],
    },
    undefined,
    mode,
  );

const writeOffRows = (stepId: string) =>
  runAsTenant(orgId, (tx) =>
    tx.stockLedgerEntry.findMany({
      where: {
        organizationId: orgId,
        sourceDocType: SOURCE_DOC_TYPES.jobOrderStep,
        sourceDocId: stepId,
      },
      select: { movementType: true, qtyOut: true, valueOut: true, sourceDocLineId: true },
    }),
  );

const qtyAt = async (batchId: string, locationId: string) =>
  (
    await runAsTenant(orgId, (tx) => getBalance(tx, { organizationId: orgId, batchId, locationId }))
  ).qty.toString();

/** Cotton ₹10/m, 1,000 m planned for 950 m of dyed cloth, all of it issued. */
async function dyeingRun(owner?: string) {
  const cotton = await makeItem('Cotton');
  const dyed = await makeItem('Dyed');
  const batch = await seedStock(cotton, 1100, 10, owner);
  const { jobOrderId, stepIds } = await order(
    [
      {
        inputs: [{ itemId: cotton, plannedQty: 1000 }],
        outputs: [{ itemId: dyed, expectedQty: 950, rate: 12 }],
      },
    ],
    owner,
  );
  const stepId = stepIds[0]!;
  const challan = await issue(stepId, cotton, batch.id, 1000);
  return { cotton, dyed, batch, jobOrderId, stepId, challan };
}

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `write-off-${unique()}`, orgCode: uniqueOrgCode() },
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
    customerId = (
      await tx.customer.create({
        data: {
          organizationId: orgId,
          contactName: 'Mehta Textiles',
          contactNumber: `CUS-${unique()}`,
        },
        select: { id: true },
      })
    ).id;
  });

  processId = (await createNewProcess(orgId, { name: `Dyeing ${unique()}` })).id;
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
    await tx.customer.deleteMany({ where: { organizationId: orgId } });
    await tx.unitOfMeasurement.deleteMany({ where: { organizationId: orgId } });
    await tx.numberSequence.deleteMany({ where: { organizationId: orgId } });
  });
  await deleteTestOrganization(orgId);
});

describe('completing a step — the write-off', { timeout: 120_000 }, () => {
  it('A: writes off nothing when the receipts used everything', async () => {
    const run = await dyeingRun();
    await receive(run.stepId, [run.challan.id], run.cotton, run.dyed, 500);
    await receive(run.stepId, [run.challan.id], run.cotton, run.dyed, 450);

    await manuallyCompleteStep(orgId, run.jobOrderId, run.stepId, undefined);

    expect(await writeOffRows(run.stepId)).toHaveLength(0);
    expect(await qtyAt(run.batch.id, run.challan.processorLocationId)).toBe('0');
  });

  it('B: scraps what is left at its cost, and the step reports it as loss', async () => {
    const run = await dyeingRun();
    await receive(run.stepId, [run.challan.id], run.cotton, run.dyed, 500);
    await receive(run.stepId, [run.challan.id], run.cotton, run.dyed, 420);

    const overview = await manuallyCompleteStep(orgId, run.jobOrderId, run.stepId, undefined);

    const rows = await writeOffRows(run.stepId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.movementType).toBe('scrap');
    expect(rows[0]!.qtyOut.toString()).toBe('31.5789');
    expect(rows[0]!.valueOut.toString()).toBe('315.789');
    expect(await qtyAt(run.batch.id, run.challan.processorLocationId)).toBe('0');

    const step = overview.steps[0]!;
    expect(step.status).toBe('completed');
    expect(step.totals.writtenOffQty).toBe('31.5789');
    expect(step.totals.writtenOffValue).toBe('315.789');
    expect(step.totals.outstandingQty).toBe('0');
    expect(step.itemTotals.inputs[0]!.writtenOffQty).toBe('31.5789');
    expect(step.itemTotals.inputs[0]!.writtenOffValue).toBe('315.789');
    expect(step.itemTotals.inputs[0]!.stillOutQty).toBe('0');
    // (5,263.158 + 6,000 + 4,421.053 + 5,040) ÷ 920 accepted — the stored breakdowns.
    expect(step.itemTotals.outputs[0]!.acceptedQty).toBe('920');
    expect(step.itemTotals.outputs[0]!.landedCostPerUnit).toBe('22.5263');
  });

  it('customer-owned: writes the quantity off at zero value', async () => {
    const run = await dyeingRun(customerId);
    await receive(run.stepId, [run.challan.id], run.cotton, run.dyed, 500);

    await manuallyCompleteStep(orgId, run.jobOrderId, run.stepId, undefined);

    const rows = await writeOffRows(run.stepId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.qtyOut.toString()).toBe('473.6842');
    expect(rows[0]!.valueOut.toString()).toBe('0');
    expect(await qtyAt(run.batch.id, run.challan.processorLocationId)).toBe('0');
  });

  it('close short writes off every step it closes', async () => {
    const cotton = await makeItem('Cotton');
    const dyed = await makeItem('Dyed');
    const finished = await makeItem('Finished');
    const batch = await seedStock(cotton, 1000, 10);
    const { jobOrderId, stepIds } = await order([
      {
        inputs: [{ itemId: cotton, plannedQty: 1000 }],
        outputs: [{ itemId: dyed, expectedQty: 950 }],
      },
      {
        inputs: [{ itemId: dyed, plannedQty: 500 }],
        outputs: [{ itemId: finished, expectedQty: 500 }],
      },
    ]);
    const [dyeing, finishing] = stepIds as [string, string];

    const dyeChallan = await issue(dyeing, cotton, batch.id, 1000);
    const receipt = await receive(dyeing, [dyeChallan.id], cotton, dyed, 500);
    const finishChallan = await issue(finishing, dyed, receipt.outputBatchId!, 500);

    await shortCloseJobOrder(orgId, jobOrderId, 'Party cancelled the rest');

    const dyeRows = await writeOffRows(dyeing);
    const finishRows = await writeOffRows(finishing);
    expect(dyeRows.map((row) => row.qtyOut.toString())).toEqual(['473.6842']);
    expect(finishRows.map((row) => row.qtyOut.toString())).toEqual(['500']);
    expect(await qtyAt(batch.id, dyeChallan.processorLocationId)).toBe('0');
    expect(await qtyAt(receipt.outputBatchId!, finishChallan.processorLocationId)).toBe('0');

    const overview = await getJobOrderOverview(orgId, jobOrderId);
    expect(overview.steps.map((step) => step.status)).toEqual(['short_closed', 'short_closed']);
  });
});

describe('a completed step is closed (R9)', { timeout: 120_000 }, () => {
  it('refuses issuing, cancelling a challan, and completing it again', async () => {
    const run = await dyeingRun();
    const second = await issue(run.stepId, run.cotton, run.batch.id, 50);
    await receive(run.stepId, [run.challan.id], run.cotton, run.dyed, 500);
    await manuallyCompleteStep(orgId, run.jobOrderId, run.stepId, undefined);

    await expect(issue(run.stepId, run.cotton, run.batch.id, 10)).rejects.toMatchObject({
      status: 409,
    });
    await expect(cancelJobIssue(orgId, second.id, 'too late')).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      manuallyCompleteStep(orgId, run.jobOrderId, run.stepId, undefined),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses completion while a draft is parked on the step', async () => {
    const run = await dyeingRun();
    await receive(run.stepId, [run.challan.id], run.cotton, run.dyed, 500, 'draft');

    await expect(
      manuallyCompleteStep(orgId, run.jobOrderId, run.stepId, undefined),
    ).rejects.toMatchObject({ status: 409 });
    expect(await writeOffRows(run.stepId)).toHaveLength(0);
  });
});
