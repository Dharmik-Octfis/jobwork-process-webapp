import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { deleteTestOrganization, uniqueOrgCode } from '../../../db/testTenant.ts';
import { createBatch, postMovement } from '../../inventory/stock-ledger/stockLedger.service.ts';
import { getAvailableStock, getSourceLocations } from '../../inventory/batches/batches.service.ts';
import { SOURCE_DOC_TYPES, runAsDocument } from '../jobwork.types.ts';
import { createNewProcess } from '../processes/processes.service.ts';
import { createNewRoute } from '../process-routes/processRoutes.service.ts';
import { createNewJobOrder } from '../job-orders/jobOrders.service.ts';
import { createNewJobIssue } from './jobIssues.service.ts';
import type { ProcessorType } from '../jobwork.types.ts';

/**
 * 🔴 A CUSTOMER ORDER DRAWS ON ITS OWN CUSTOMER'S GOODS AND NO ONE ELSE'S.
 *
 * `ownership: 'customer'` matches every customer's stock. Until 2026-09-24 the
 * posting path filtered on that alone, so Customer A's order could issue — and,
 * for an untracked item, FIFO would silently pick — Customer B's material sitting
 * in the same godown. Only the draft path checked the owner party.
 *
 * Every row here is created by this file and hard-deleted afterwards (CLAUDE.md).
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let trackedId: string;
let looseId: string;
let outputId: string;
let godownId: string;
let dyerId: string;
let customerA: string;
let customerB: string;

async function seedCustomerStock(itemId: string, ownerPartyId: string, qty: number) {
  return runAsDocument(orgId, async (tx) => {
    const batch = await createBatch(tx, {
      organizationId: orgId,
      itemId,
      ownership: 'customer',
      ownerPartyId,
      supplierBatchRef: `OWNER-${unique()}`,
      sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
    });
    await postMovement(tx, {
      organizationId: orgId,
      batchId: batch.id,
      locationId: godownId,
      movementType: 'receipt',
      qtyIn: qty,
      sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
      sourceDocId: batch.id,
    });
    return batch;
  });
}

/** A one-step order for Customer A consuming `itemId`. */
async function customerOrder(itemId: string) {
  const process = await createNewProcess(orgId, { name: `Dyeing ${unique()}` });
  const route = await createNewRoute(orgId, {
    name: `Owner route ${unique()}`,
    steps: [
      {
        processId: process.id,
        processorId: dyerId,
        inputs: [{ itemId }],
        outputs: [{ itemId: outputId, isPrimary: true }],
      },
    ],
  });
  const order = await createNewJobOrder(orgId, {
    routeId: route.id,
    ownership: 'customer',
    ownerPartyId: customerA,
    steps: route.steps.map((step) => ({
      processId: step.processId,
      processorType: step.processorType as ProcessorType,
      processorId: step.processorId,
      inputs: step.inputs.map((row) => ({ itemId: row.itemId })),
      outputs: step.outputs.map((row) => ({ itemId: row.itemId, isPrimary: row.isPrimary })),
      plannedInputQty: 100,
    })),
  });
  return order.steps[0]!;
}

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `issue-owner-${unique()}`, orgCode: uniqueOrgCode() },
    select: { id: true },
  });
  orgId = org.id;

  await runAsTenant(orgId, async (tx) => {
    const metre = await tx.unitOfMeasurement.create({
      data: { organizationId: orgId, unitName: 'Metre', symbol: 'MTR' },
      select: { id: true },
    });
    const item = (name: string, inventoryTracking: string) =>
      tx.item.create({
        data: {
          organizationId: orgId,
          name,
          sku: `OWNER-${unique()}`,
          unit: 'Metre',
          stockingUomId: metre.id,
          inventoryTracking,
        },
        select: { id: true },
      });
    trackedId = (await item('Grey Fabric', 'batch')).id;
    looseId = (await item('Grey Yarn', 'none')).id;
    outputId = (await item('Dyed Fabric', 'batch')).id;

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
    const customer = (name: string) =>
      tx.customer.create({
        data: { organizationId: orgId, contactName: name, contactNumber: `CUS-${unique()}` },
        select: { id: true },
      });
    customerA = (await customer('Principal A')).id;
    customerB = (await customer('Principal B')).id;
  });
});

afterAll(async () => {
  await runAsTenant(orgId, async (tx) => {
    await tx.jobIssueLine.deleteMany({ where: { organizationId: orgId } });
    await tx.jobIssue.deleteMany({ where: { organizationId: orgId } });
    await tx.jobOrderStepInput.deleteMany({ where: { organizationId: orgId } });
    await tx.jobOrderStepOutput.deleteMany({ where: { organizationId: orgId } });
    await tx.jobOrderStep.deleteMany({ where: { organizationId: orgId } });
    await tx.jobOrder.deleteMany({ where: { organizationId: orgId } });
    await tx.routeStep.deleteMany({ where: { organizationId: orgId } });
    await tx.route.deleteMany({ where: { organizationId: orgId } });
    await tx.stockLedgerEntry.deleteMany({ where: { organizationId: orgId } });
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

describe('customer issue — owner party isolation', { timeout: 120_000 }, () => {
  it('refuses another customer’s batch and accepts its own', async () => {
    const theirs = await seedCustomerStock(trackedId, customerB, 100);
    const ours = await seedCustomerStock(trackedId, customerA, 100);
    const step = await customerOrder(trackedId);

    await expect(
      createNewJobIssue(orgId, {
        jobOrderStepId: step.id,
        sourceLocationId: godownId,
        lines: [{ itemId: trackedId, batchId: theirs.id, qty: 50 }],
      }),
    ).rejects.toThrow(/no stock available here/);

    const issue = await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      lines: [{ itemId: trackedId, batchId: ours.id, qty: 50 }],
    });
    expect(issue.lines.map((line) => line.batchId)).toEqual([ours.id]);
  });

  it('never lets FIFO reach another customer’s older stock for an untracked item', async () => {
    // B's stock is OLDER, so an owner-blind FIFO queue would take it first.
    await seedCustomerStock(looseId, customerB, 100);
    const ours = await seedCustomerStock(looseId, customerA, 60);
    const step = await customerOrder(looseId);

    const issue = await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      lines: [{ itemId: looseId, qty: 60 }],
    });
    expect(issue.lines.map((line) => line.batchId)).toEqual([ours.id]);

    // …and B's 100 does not count towards what A's order may take.
    await expect(
      createNewJobIssue(orgId, {
        jobOrderStepId: step.id,
        sourceLocationId: godownId,
        lines: [{ itemId: looseId, qty: 1 }],
      }),
    ).rejects.toThrow(/has 0 available/);
  });

  it('the picker and the location list offer only that customer’s goods', async () => {
    const theirs = await seedCustomerStock(trackedId, customerB, 30);
    const ours = await seedCustomerStock(trackedId, customerA, 20);

    const offered = await getAvailableStock(orgId, {
      itemId: trackedId,
      locationId: godownId,
      ownership: 'customer',
      ownerPartyId: customerA,
    });
    const ids = offered.map((row) => row.batchId);
    expect(ids).toContain(ours.id);
    expect(ids).not.toContain(theirs.id);

    // Earlier tests in this file left stock of both customers here, so the
    // expected figure is A's own ledger balance, not a hardcoded number.
    const locations = await getSourceLocations(orgId, {
      itemIds: [trackedId],
      ownership: 'customer',
      ownerPartyId: customerA,
    });
    const aBalance = await runAsTenant(orgId, (tx) =>
      tx.stockLedgerEntry.aggregate({
        where: {
          organizationId: orgId,
          itemId: trackedId,
          locationId: godownId,
          ownerPartyId: customerA,
        },
        _sum: { qtyIn: true, qtyOut: true },
      }),
    );
    const expected = Number(aBalance._sum.qtyIn ?? 0) - Number(aBalance._sum.qtyOut ?? 0);
    const godown = locations.find((row) => row.id === godownId);
    expect(Number(godown?.availableQty)).toBe(expected);
  });
});
