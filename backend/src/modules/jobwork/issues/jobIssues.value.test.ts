import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { deleteTestOrganization, uniqueOrgCode } from '../../../db/testTenant.ts';
import { createBatch, postMovement } from '../../inventory/stock-ledger/stockLedger.service.ts';
import { SOURCE_DOC_TYPES, runAsDocument } from '../jobwork.types.ts';
import { createNewProcess } from '../processes/processes.service.ts';
import { createNewJobOrder } from '../job-orders/jobOrders.service.ts';
import { createNewJobIssue } from './jobIssues.service.ts';

/**
 * 🔴 WHAT A CHALLAN LINE IS WORTH WHEN TWO LINES DRAW ON ONE BATCH.
 *
 * `createNewJobIssue` used to ask `getBalance` per line — a round trip each, on
 * the transaction's one connection. It now reads every line's balance in one
 * query and decrements its copy as each `transfer_out` is posted.
 *
 * Those are the same thing ONLY because of the decrement. Reading once and
 * valuing every line against that one answer is the obvious version of the
 * change, and this file is the reason it is wrong: a unit value only survives
 * consumption unchanged while the division is exact, and inventory arithmetic
 * mostly is not.
 *
 * 🔴 Every row here is created by this file and hard-deleted afterwards. Suites
 * run against the dev database IN PARALLEL, so nothing here reads pre-existing
 * data (CLAUDE.md).
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let greyId: string;
let dyedId: string;
let godownId: string;
let dyerId: string;
let processId: string;

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `issue-value-${unique()}`, orgCode: uniqueOrgCode() },
    select: { id: true },
  });
  orgId = org.id;

  await runAsTenant(orgId, async (tx) => {
    const metre = await tx.unitOfMeasurement.create({
      data: { organizationId: orgId, unitName: 'Metre', symbol: 'MTR' },
      select: { id: true },
    });

    const make = async (name: string) =>
      (
        await tx.item.create({
          data: {
            organizationId: orgId,
            name,
            sku: `IV-${name}-${unique()}`,
            unit: 'Metre',
            stockingUomId: metre.id,
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
  // Bottom-up: `stock_ledger` holds RESTRICT foreign keys to items, batches and
  // locations, so letting the organization cascade would hit them in whatever
  // order Postgres chose.
  await runAsTenant(orgId, async (tx) => {
    await tx.jobIssueLine.deleteMany({ where: { organizationId: orgId } });
    await tx.jobIssue.deleteMany({ where: { organizationId: orgId } });
    await tx.jobOrderStepInput.deleteMany({ where: { organizationId: orgId } });
    await tx.jobOrderStepOutput.deleteMany({ where: { organizationId: orgId } });
    await tx.jobOrderStep.deleteMany({ where: { organizationId: orgId } });
    await tx.jobOrder.deleteMany({ where: { organizationId: orgId } });
    await tx.stockLedgerEntry.deleteMany({ where: { organizationId: orgId } });
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

describe('issue — two lines drawing on one batch', { timeout: 60_000 }, () => {
  it('values the second line against what the first one left', async () => {
    /* 🔴 3 metres worth 10 — a unit value of 3.333… that does NOT divide evenly,
       which is what makes the two implementations disagree. Whole numbers would
       hide it: consumption is proportional, so an exact unit value survives it
       unchanged and every version of this code would agree. */
    const batch = await runAsDocument(orgId, async (tx) => {
      const created = await createBatch(tx, {
        organizationId: orgId,
        itemId: greyId,
        ownership: 'own',
        supplierBatchRef: `SEED-${unique()}`,
        sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
      });
      await postMovement(tx, {
        organizationId: orgId,
        batchId: created.id,
        locationId: godownId,
        movementType: 'receipt',
        qtyIn: 3,
        valueIn: 10,
        sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
        sourceDocId: created.id,
      });
      return created;
    });

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
          plannedInputQty: 2,
        },
      ],
    });

    // Two lines, one metre each, both off the SAME batch at the same godown.
    await createNewJobIssue(orgId, {
      jobOrderStepId: jobOrder.steps[0]!.id,
      sourceLocationId: godownId,
      lines: [
        { itemId: greyId, batchId: batch.id, qty: 1 },
        { itemId: greyId, batchId: batch.id, qty: 1 },
      ],
    });

    const out = await runAsTenant(orgId, (tx) =>
      tx.stockLedgerEntry.findMany({
        where: { organizationId: orgId, batchId: batch.id, movementType: 'transfer_out' },
        orderBy: { createdAt: 'asc' },
        select: { valueOut: true },
      }),
    );

    /* 10 ÷ 3 = 3.3333 for the first metre. That leaves 6.6667 across 2 metres —
       3.33335 each — so the second is 3.3334, NOT another 3.3333. Valued against
       a single up-front read both lines read 3.3333 and a paisa goes missing. */
    expect(out.map((row) => row.valueOut.toString())).toEqual(['3.3333', '3.3334']);
  });
});
