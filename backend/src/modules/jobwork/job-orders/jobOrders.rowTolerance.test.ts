import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { deleteTestOrganization, uniqueOrgCode } from '../../../db/testTenant.ts';
import { createBatch, postMovement } from '../../inventory/stock-ledger/stockLedger.service.ts';
import { SOURCE_DOC_TYPES, runAsDocument } from '../jobwork.types.ts';
import { createNewProcess } from '../processes/processes.service.ts';
import { createNewJobIssue } from '../issues/jobIssues.service.ts';
import { createNewJobOrder } from './jobOrders.service.ts';

/**
 * 🔴 Tolerance is typed per job order input row, and nothing fills it in.
 *
 * The item default it used to be copied from was removed 2026-09-16; the Process
 * and step tolerances before that. The over-issue ceiling reads the row alone.
 *
 * Every row is created by this file and hard-deleted afterwards (CLAUDE.md).
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let metreId: string;
let godownId: string;
let dyerId: string;
let processId: string;

async function makeItem(name: string) {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name,
        sku: `TOL-${name}-${unique()}`,
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

const orderFor = (inputs: { itemId: string; plannedQty: number; tolerancePct?: number | null }[]) =>
  createNewJobOrder(orgId, {
    steps: [
      {
        processId,
        processorType: 'vendor',
        processorId: dyerId,
        inputs,
        // The first input passes through — the output is beside the point here, and
        // a pass-through is exempt from the several-inputs rule (landed-cost plan V1).
        outputs: [{ itemId: inputs[0]!.itemId, isPrimary: true }],
      },
    ],
  });

const toleranceOnRows = (stepId: string) =>
  runAsTenant(orgId, async (tx) =>
    (
      await tx.jobOrderStepInput.findMany({
        where: { organizationId: orgId, jobOrderStepId: stepId, isDeleted: false },
        orderBy: { seq: 'asc' },
        select: { tolerancePct: true },
      })
    ).map((row) => row.tolerancePct?.toString() ?? null),
  );

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `item-tolerance-${unique()}`, orgCode: uniqueOrgCode() },
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

  processId = (await createNewProcess(orgId, { name: `Dyeing ${unique()}` })).id;
});

afterAll(async () => {
  if (!orgId) return deleteTestOrganization(orgId);
  await runAsTenant(orgId, async (tx) => {
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

describe('row-wise tolerance', { timeout: 60_000 }, () => {
  it('stores each typed value as typed, 0 included, and leaves a blank row blank', async () => {
    const fabricId = await makeItem('Fabric');
    const threadId = await makeItem('Thread');
    const buttonId = await makeItem('Button');

    const order = await orderFor([
      { itemId: fabricId, plannedQty: 100 },
      { itemId: threadId, plannedQty: 10, tolerancePct: 2 },
      { itemId: buttonId, plannedQty: 50, tolerancePct: 0 },
    ]);

    expect(await toleranceOnRows(order.steps[0]!.id)).toEqual([null, '2', '0']);
  });

  it('measures the over-issue ceiling against the row alone', async () => {
    const fabricId = await makeItem('Fabric');
    const batch = await seedStock(fabricId, 200);
    const order = await orderFor([{ itemId: fabricId, plannedQty: 100, tolerancePct: 5 }]);

    // 100 planned + 5% = 105. 106 is over.
    await expect(
      createNewJobIssue(orgId, {
        jobOrderStepId: order.steps[0]!.id,
        sourceLocationId: godownId,
        lines: [{ itemId: fabricId, batchId: batch.id, qty: 106 }],
      }),
    ).rejects.toMatchObject({ status: 400 });

    const issue = await createNewJobIssue(orgId, {
      jobOrderStepId: order.steps[0]!.id,
      sourceLocationId: godownId,
      lines: [{ itemId: fabricId, batchId: batch.id, qty: 105 }],
    });
    expect(issue.status).toBe('issued');
  });

  it('leaves a row with no percentage unchecked', async () => {
    const fabricId = await makeItem('Fabric');
    const batch = await seedStock(fabricId, 300);
    const order = await orderFor([{ itemId: fabricId, plannedQty: 100 }]);

    expect(await toleranceOnRows(order.steps[0]!.id)).toEqual([null]);

    const issue = await createNewJobIssue(orgId, {
      jobOrderStepId: order.steps[0]!.id,
      sourceLocationId: godownId,
      lines: [{ itemId: fabricId, batchId: batch.id, qty: 300 }],
    });
    expect(issue.status).toBe('issued');
  });
});
