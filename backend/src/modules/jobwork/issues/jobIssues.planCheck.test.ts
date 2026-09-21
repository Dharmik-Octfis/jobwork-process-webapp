import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { deleteTestOrganization, uniqueOrgCode } from '../../../db/testTenant.ts';
import { createBatch, postMovement } from '../../inventory/stock-ledger/stockLedger.service.ts';
import { SOURCE_DOC_TYPES, runAsDocument } from '../jobwork.types.ts';
import { createNewProcess } from '../processes/processes.service.ts';
import { createNewJobOrder } from '../job-orders/jobOrders.service.ts';
import { createNewJobReceipt } from '../receipts/jobReceipts.service.ts';
import { createNewJobIssue } from './jobIssues.service.ts';

/**
 * 🔴 The plan must be complete before material leaves (landed-cost plan D11, V4;
 * §8 test 12). Every receipt is costed from planned input against expected output,
 * and a step cannot be re-planned once a challan exists.
 *
 * Every row is created by this file and hard-deleted afterwards (CLAUDE.md).
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let metreId: string;
let godownId: string;
let dyerId: string;
let processId: string;
let fabricId: string;
let dyedId: string;
let dyedTwoId: string;

async function makeItem(name: string) {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name,
        sku: `PLAN-${name}-${unique()}`,
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

type Row = { itemId: string; plannedQty?: number; expectedQty?: number; sharePct?: number };

const order = (inputs: Row[], outputs: Row[]) =>
  createNewJobOrder(orgId, {
    steps: [{ processId, processorType: 'vendor', processorId: dyerId, inputs, outputs }],
  });

const issue = (
  stepId: string,
  line: { itemId: string; batchId: string; qty: number },
  mode: 'post' | 'draft' = 'post',
  extra: { isRework?: boolean } = {},
) =>
  createNewJobIssue(
    orgId,
    { jobOrderStepId: stepId, sourceLocationId: godownId, lines: [line], ...extra },
    undefined,
    mode,
  );

const planRefused = { status: 400, details: { plan: expect.any(String) } };

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `plan-check-${unique()}`, orgCode: uniqueOrgCode() },
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
  });

  fabricId = await makeItem('Fabric');
  dyedId = await makeItem('Dyed');
  dyedTwoId = await makeItem('Dyed Two');
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

describe('issue — the plan check', { timeout: 60_000 }, () => {
  it('refuses a posted challan while a planned quantity is missing', async () => {
    const batch = await seedStock(fabricId, 100);
    const jo = await order([{ itemId: fabricId }], [{ itemId: dyedId }]);

    await expect(
      issue(jo.steps[0]!.id, { itemId: fabricId, batchId: batch.id, qty: 100 }),
    ).rejects.toMatchObject(planRefused);
  });

  it('refuses while an output has no expected quantity', async () => {
    const batch = await seedStock(fabricId, 100);
    // Two outputs, so nothing defaults the Expected boxes.
    const jo = await order(
      [{ itemId: fabricId, plannedQty: 100 }],
      [
        { itemId: dyedId, sharePct: 50 },
        { itemId: dyedTwoId, sharePct: 50 },
      ],
    );

    await expect(
      issue(jo.steps[0]!.id, { itemId: fabricId, batchId: batch.id, qty: 100 }),
    ).rejects.toMatchObject(planRefused);
  });

  it('refuses a step that lists nothing it produces', async () => {
    const batch = await seedStock(fabricId, 100);
    const jo = await order([{ itemId: fabricId, plannedQty: 100 }], []);

    await expect(
      issue(jo.steps[0]!.id, { itemId: fabricId, batchId: batch.id, qty: 100 }),
    ).rejects.toMatchObject(planRefused);
  });

  it('parks a draft against an incomplete plan', async () => {
    const batch = await seedStock(fabricId, 100);
    const jo = await order([{ itemId: fabricId }], [{ itemId: dyedId }]);

    const draft = await issue(
      jo.steps[0]!.id,
      { itemId: fabricId, batchId: batch.id, qty: 100 },
      'draft',
    );
    expect(draft.status).toBe('draft');
  });

  it('posts once the plan is complete', async () => {
    const batch = await seedStock(fabricId, 100);
    // One output, so its Expected defaults from the planned input.
    const jo = await order([{ itemId: fabricId, plannedQty: 100 }], [{ itemId: dyedId }]);

    const challan = await issue(jo.steps[0]!.id, { itemId: fabricId, batchId: batch.id, qty: 100 });
    expect(challan.status).toBe('issued');
  });

  it('R1b: refuses a share-split step whose shares were lost after it was saved', async () => {
    const batch = await seedStock(fabricId, 100);
    const jo = await order(
      [{ itemId: fabricId, plannedQty: 100 }],
      [
        { itemId: dyedId, expectedQty: 91, sharePct: 91 },
        { itemId: dyedTwoId, expectedQty: 1, sharePct: 9 },
      ],
    );
    const stepId = jo.steps[0]!.id;
    // Save refuses a blank share; this is the net under it, for a row changed by hand.
    await runAsTenant(orgId, (tx) =>
      tx.jobOrderStepOutput.updateMany({
        where: { organizationId: orgId, jobOrderStepId: stepId, itemId: dyedTwoId },
        data: { sharePct: null },
      }),
    );

    await expect(
      issue(stepId, { itemId: fabricId, batchId: batch.id, qty: 100 }),
    ).rejects.toMatchObject(planRefused);
  });

  it('R1b: lets a step that sent material before shares existed keep sending', async () => {
    const batch = await seedStock(fabricId, 200);
    const jo = await order(
      [{ itemId: fabricId, plannedQty: 200 }],
      [
        { itemId: dyedId, expectedQty: 91, sharePct: 91 },
        { itemId: dyedTwoId, expectedQty: 1, sharePct: 9 },
      ],
    );
    const stepId = jo.steps[0]!.id;
    await issue(stepId, { itemId: fabricId, batchId: batch.id, qty: 100 });

    // What a step planned before the column existed looks like.
    await runAsTenant(orgId, (tx) =>
      tx.jobOrderStepOutput.updateMany({
        where: { organizationId: orgId, jobOrderStepId: stepId },
        data: { sharePct: null },
      }),
    );

    const second = await issue(stepId, { itemId: fabricId, batchId: batch.id, qty: 100 });
    expect(second.status).toBe('issued');
  });

  it('does not ask a rework challan for the plan', async () => {
    const batch = await seedStock(fabricId, 100);
    const jo = await order([{ itemId: fabricId, plannedQty: 100 }], [{ itemId: dyedId }]);
    const stepId = jo.steps[0]!.id;

    const first = await issue(stepId, { itemId: fabricId, batchId: batch.id, qty: 100 });
    const receipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: stepId,
      issueIds: [first.id],
      locationId: godownId,
      lines: [{ itemId: fabricId, issuedQty: 100, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 100,
          acceptedQty: 90,
          reworkQty: 10,
          batchReference: `OK-${unique()}`,
          reworkBatchReference: `RW-${unique()}`,
        },
      ],
    });

    // The plan loses its Expected afterwards, as a legacy step's would be.
    await runAsTenant(orgId, (tx) =>
      tx.jobOrderStepOutput.updateMany({
        where: { organizationId: orgId, jobOrderStepId: stepId },
        data: { expectedQty: null },
      }),
    );

    const rework = await issue(
      stepId,
      { itemId: dyedId, batchId: receipt.reworkBatchId!, qty: 10 },
      'post',
      { isRework: true },
    );
    expect(rework.status).toBe('issued');
  });
});
