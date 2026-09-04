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
import { createNewRoute } from './process-routes/processRoutes.service.ts';
import { createNewJobOrder, getJobOrderById } from './job-orders/jobOrders.service.ts';
import {
  createNewJobIssue,
  deleteJobIssueDraft,
  postJobIssueDraft,
} from './issues/jobIssues.service.ts';
import {
  createNewJobReceipt,
  deleteJobReceiptDraft,
  getReceivePrefill,
} from './receipts/jobReceipts.service.ts';
import { chainNotReady, getStepTotals } from './job-orders/jobOrders.status.ts';
import type { ProcessorType } from './jobwork.types.ts';

/**
 * 🔴 SAVING A DRAFT MUST CHANGE NOTHING — the one guarantee the whole feature is
 * for, and the one that cannot be seen by looking at a screen.
 *
 * A draft is a normal `job_issues` / `job_receipts` row carrying real lines and
 * real totals, with NO ledger rows behind them. That makes it invisible only
 * because ~15 separate queries filter it out (`POSTED_DOC_STATUS`), and the
 * failure when one of them does not is silent and expensive: the Overview reports
 * material at a processor that is still in the godown, the next step's chain guard
 * opens on goods that never came back, and the stock report and the job order
 * disagree with no way to tell which is lying.
 *
 * So this file asserts the ABSENCE of effects, on both sides:
 *   · no `stock_ledger` row, no balance moved, no batch created;
 *   · step totals, step status and job order status all untouched;
 *   · the challans a draft receipt names stay open and receivable;
 *   · the chain guard still refuses the next step.
 *
 * …and then that posting the same draft does all of it properly, through the
 * ordinary path.
 *
 * 🔴 Every row here is created by this file and hard-deleted afterwards. Suites
 * run against the dev database IN PARALLEL, so nothing may read or mutate
 * pre-existing data (CLAUDE.md).
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let greyId: string;
let dyedId: string;
let metreId: string;
let godownId: string;
let dyerId: string;

async function seedStock(itemId: string, qty: number, value = 0) {
  return runAsDocument(orgId, async (tx) => {
    const batch = await createBatch(tx, {
      organizationId: orgId,
      itemId,
      ownership: 'own',
      supplierBatchRef: `DRAFT-${itemId.slice(0, 8)}-${unique()}`,
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

/** A fresh two-step order with its own stock, so each test is independent. */
async function makeOrder() {
  const dyeing = await createNewProcess(orgId, {
    name: `Dyeing ${unique()}`,
    rateBasis: 'per_issued_unit',
  });
  const finishing = await createNewProcess(orgId, { name: `Finishing ${unique()}` });

  const route = await createNewRoute(orgId, {
    name: `Draft route ${unique()}`,
    steps: [
      {
        processId: dyeing.id,
        processorId: dyerId,
        rate: 10,
        inputs: [{ itemId: greyId }],
        outputs: [{ itemId: dyedId, isPrimary: true }],
        tolerancePct: 5,
      },
      {
        processId: finishing.id,
        processorId: dyerId,
        rate: 4,
        inputs: [{ itemId: dyedId }],
        outputs: [{ itemId: dyedId, isPrimary: true }],
      },
    ],
  });

  const order = await createNewJobOrder(orgId, {
    routeId: route.id,
    steps: route.steps.map((step, index) => ({
      processId: step.processId,
      processorType: step.processorType as ProcessorType,
      processorId: step.processorId,
      rate: step.rate === null ? null : Number(step.rate),
      rateBasis: step.rateBasis as 'per_issued_unit' | 'per_received_unit' | null,
      inputs: step.inputs.map((row) => ({ itemId: row.itemId })),
      outputs: step.outputs.map((row) => ({ itemId: row.itemId, isPrimary: row.isPrimary })),
      tolerancePct: step.tolerancePct === null ? null : Number(step.tolerancePct),
      plannedInputQty: index === 0 ? 1000 : null,
    })),
  });

  const batch = await seedStock(greyId, 1000, 50000);
  return { order, batch, step1: order.steps[0]!, step2: order.steps[1]! };
}

const ledgerRowsFor = (docType: string, docId: string) =>
  runAsTenant(orgId, (tx) =>
    tx.stockLedgerEntry.count({
      where: { organizationId: orgId, sourceDocType: docType, sourceDocId: docId },
    }),
  );

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `jobwork-drafts-${unique()}`, orgCode: uniqueOrgCode() },
    select: { id: true },
  });
  orgId = org.id;

  await runAsTenant(orgId, async (tx) => {
    const metre = await tx.unitOfMeasurement.create({
      data: { organizationId: orgId, unitName: 'Metre', symbol: 'MTR' },
      select: { id: true },
    });
    metreId = metre.id;

    const grey = await tx.item.create({
      data: {
        organizationId: orgId,
        name: 'Grey Fabric',
        sku: `DRAFT-GREY-${unique()}`,
        unit: 'Metre',
        stockingUomId: metreId,
        inventoryTracking: 'batch',
      },
      select: { id: true },
    });
    greyId = grey.id;

    const dyed = await tx.item.create({
      data: {
        organizationId: orgId,
        name: 'Dyed Fabric',
        sku: `DRAFT-DYED-${unique()}`,
        unit: 'Metre',
        stockingUomId: metreId,
        inventoryTracking: 'batch',
      },
      select: { id: true },
    });
    dyedId = dyed.id;

    const godown = await tx.location.create({
      data: { organizationId: orgId, name: 'Main Godown', type: 'godown' },
      select: { id: true },
    });
    godownId = godown.id;

    const dyer = await tx.vendor.create({
      data: {
        organizationId: orgId,
        contactName: 'Sunrise Dyers',
        companyName: 'Sunrise Dyers Pvt Ltd',
        contactNumber: `VEN-${unique()}`,
        vendorTypes: ['job_worker'],
      },
      select: { id: true },
    });
    dyerId = dyer.id;
  });
});

afterAll(async () => {
  // Bottom-up: `stock_ledger` holds RESTRICT keys to items, batches and
  // locations, so a cascade would hit them in whatever order Postgres chose.
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
    await tx.routeStep.deleteMany({ where: { organizationId: orgId } });
    await tx.route.deleteMany({ where: { organizationId: orgId } });
    await tx.batchUnit.deleteMany({ where: { organizationId: orgId } });
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

describe('a draft issue affects nothing', { timeout: 120_000 }, () => {
  it('moves no stock, and leaves the step and the order exactly as they were', async () => {
    const { order, batch, step1 } = await makeOrder();

    const draft = await createNewJobIssue(
      orgId,
      {
        jobOrderStepId: step1.id,
        sourceLocationId: godownId,
        lines: [{ itemId: greyId, batchId: batch.id, qty: 400 }],
      },
      undefined,
      'draft',
    );

    expect(draft.status).toBe('draft');
    // A draft IS a save, so it takes its number then — and keeps it.
    expect(draft.challanNumber).toMatch(/^JI-\d{5}$/);
    // The lines are real rows: reopening the draft has to show what was picked.
    expect(draft.lines).toHaveLength(1);
    expect(Number(draft.totalQty)).toBe(400);

    // 🔴 THE POINT — not one ledger row.
    expect(await ledgerRowsFor(SOURCE_DOC_TYPES.jobIssue, draft.id)).toBe(0);

    // The stock never left the godown.
    const atGodown = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId: batch.id, locationId: godownId }),
    );
    expect(atGodown.qty.toString()).toBe('1000');

    // The step counts nothing, so it has not advanced…
    const totals = await runAsTenant(orgId, (tx) => getStepTotals(tx, orgId, step1.id));
    expect(totals.issuedQty.toString()).toBe('0');
    expect(totals.issueCount).toBe(0);

    // …and neither has the order, which is still editable.
    const reread = await getJobOrderById(orgId, order.id);
    expect(reread!.status).toBe('draft');
    expect(reread!.steps[0]!.status).toBe('pending');
  });

  it('keeps its challan number when edited, and replaces its lines', async () => {
    const { batch, step1 } = await makeOrder();

    const draft = await createNewJobIssue(
      orgId,
      {
        jobOrderStepId: step1.id,
        sourceLocationId: godownId,
        lines: [{ itemId: greyId, batchId: batch.id, qty: 100 }],
      },
      undefined,
      'draft',
    );

    const edited = await createNewJobIssue(
      orgId,
      {
        jobOrderStepId: step1.id,
        sourceLocationId: godownId,
        lines: [{ itemId: greyId, batchId: batch.id, qty: 250 }],
      },
      undefined,
      'draft',
      draft.id,
    );

    expect(edited.id).toBe(draft.id);
    // 🔴 Not re-allocated. Editing a parked document must not walk a statutory
    // series forward, and the number is already on the user's screen.
    expect(edited.challanNumber).toBe(draft.challanNumber);
    expect(edited.lines).toHaveLength(1);
    expect(Number(edited.lines[0]!.qty)).toBe(250);
    expect(Number(edited.totalQty)).toBe(250);
    expect(await ledgerRowsFor(SOURCE_DOC_TYPES.jobIssue, draft.id)).toBe(0);
  });

  it('saves past a tolerance ceiling that would refuse a real issue', async () => {
    const { batch, step1 } = await makeOrder();

    // 1,000 planned + 5% = 1,050. A direct issue of 1,000 is fine; the DRAFT
    // below is not asked the question at all — availability, tolerance and the
    // step chain are all deferred to post.
    const draft = await createNewJobIssue(
      orgId,
      {
        jobOrderStepId: step1.id,
        sourceLocationId: godownId,
        // More than is on hand AND past the ceiling — both refused at post.
        lines: [{ itemId: greyId, batchId: batch.id, qty: 5000 }],
      },
      undefined,
      'draft',
    );
    expect(draft.status).toBe('draft');
    expect(Number(draft.totalQty)).toBe(5000);

    // …and posting it is refused, by the ordinary guards.
    await expect(postJobIssueDraft(orgId, draft.id)).rejects.toThrow();

    // Still a draft, still holding no stock.
    const after = await runAsTenant(orgId, (tx) =>
      tx.jobIssue.findFirstOrThrow({ where: { id: draft.id, organizationId: orgId } }),
    );
    expect(after.status).toBe('draft');
    expect(await ledgerRowsFor(SOURCE_DOC_TYPES.jobIssue, draft.id)).toBe(0);
  });

  it('posts through the ordinary path, keeping its number and moving the stock', async () => {
    const { order, batch, step1 } = await makeOrder();

    const draft = await createNewJobIssue(
      orgId,
      {
        jobOrderStepId: step1.id,
        sourceLocationId: godownId,
        lines: [{ itemId: greyId, batchId: batch.id, qty: 600 }],
      },
      undefined,
      'draft',
    );

    const posted = await postJobIssueDraft(orgId, draft.id);

    expect(posted.id).toBe(draft.id);
    expect(posted.challanNumber).toBe(draft.challanNumber);
    expect(posted.status).toBe('issued');
    // Two rows per line — out of the godown, in at the processor.
    expect(await ledgerRowsFor(SOURCE_DOC_TYPES.jobIssue, draft.id)).toBe(2);

    const atGodown = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId: batch.id, locationId: godownId }),
    );
    expect(atGodown.qty.toString()).toBe('400');

    const totals = await runAsTenant(orgId, (tx) => getStepTotals(tx, orgId, step1.id));
    expect(totals.issuedQty.toString()).toBe('600');
    expect(totals.issueCount).toBe(1);

    const reread = await getJobOrderById(orgId, order.id);
    expect(reread!.status).toBe('in_progress');
  });

  it('is deleted outright, and refuses to delete once issued', async () => {
    const { batch, step1 } = await makeOrder();

    const draft = await createNewJobIssue(
      orgId,
      {
        jobOrderStepId: step1.id,
        sourceLocationId: godownId,
        lines: [{ itemId: greyId, batchId: batch.id, qty: 50 }],
      },
      undefined,
      'draft',
    );

    await deleteJobIssueDraft(orgId, draft.id);

    const gone = await runAsTenant(orgId, (tx) =>
      tx.jobIssue.findFirstOrThrow({ where: { id: draft.id, organizationId: orgId } }),
    );
    // Soft-deleted, so the challan NUMBER stays taken — two documents must never
    // be able to share one.
    expect(gone.isDeleted).toBe(true);
    const lines = await runAsTenant(orgId, (tx) =>
      tx.jobIssueLine.count({ where: { organizationId: orgId, jobIssueId: draft.id } }),
    );
    expect(lines).toBe(0);

    // A posted challan is cancelled, never deleted.
    const real = await createNewJobIssue(orgId, {
      jobOrderStepId: step1.id,
      sourceLocationId: godownId,
      lines: [{ itemId: greyId, batchId: batch.id, qty: 50 }],
    });
    await expect(deleteJobIssueDraft(orgId, real.id)).rejects.toThrow(/Only a draft/);
  });

  it('refuses to edit a challan that has been issued', async () => {
    const { batch, step1 } = await makeOrder();

    const real = await createNewJobIssue(orgId, {
      jobOrderStepId: step1.id,
      sourceLocationId: godownId,
      lines: [{ itemId: greyId, batchId: batch.id, qty: 100 }],
    });

    await expect(
      createNewJobIssue(
        orgId,
        {
          jobOrderStepId: step1.id,
          sourceLocationId: godownId,
          lines: [{ itemId: greyId, batchId: batch.id, qty: 900 }],
        },
        undefined,
        'draft',
        real.id,
      ),
    ).rejects.toThrow(/already been issued/);
  });
});

describe('a draft receipt affects nothing', { timeout: 120_000 }, () => {
  it('creates no batch, moves no stock, and leaves the challan open', async () => {
    const { batch, step1, step2 } = await makeOrder();

    const issue = await createNewJobIssue(orgId, {
      jobOrderStepId: step1.id,
      sourceLocationId: godownId,
      lines: [{ itemId: greyId, batchId: batch.id, qty: 1000 }],
    });

    const batchesBefore = await runAsTenant(orgId, (tx) =>
      tx.batch.count({ where: { organizationId: orgId } }),
    );

    const draft = await createNewJobReceipt(
      orgId,
      {
        jobOrderStepId: step1.id,
        issueIds: [issue.id],
        locationId: godownId,
        lines: [{ itemId: greyId, issuedQty: 1000, receivedQty: 0 }],
        outputs: [
          {
            itemId: dyedId,
            isPrimary: true,
            receivedQty: 980,
            acceptedQty: 980,
            batchReference: `DYE-${unique()}`,
          },
        ],
      },
      undefined,
      'draft',
    );

    expect(draft.status).toBe('draft');
    expect(draft.receiptNumber).toMatch(/^JR-\d{5}$/);
    // The typed totals ARE stored, so the list page can show what the draft is
    // for. They are only harmless because every sum filters on the status.
    expect(Number(draft.totalReceivedQty)).toBe(980);

    // 🔴 No ledger row, and — the receipt side's own hazard — NO NEW BATCH. A
    // parked form must not give birth to inventory.
    expect(await ledgerRowsFor(SOURCE_DOC_TYPES.jobReceipt, draft.id)).toBe(0);
    const batchesAfter = await runAsTenant(orgId, (tx) =>
      tx.batch.count({ where: { organizationId: orgId } }),
    );
    expect(batchesAfter).toBe(batchesBefore);

    // The challan it names is untouched — still out, still receivable.
    const challan = await runAsTenant(orgId, (tx) =>
      tx.jobIssue.findFirstOrThrow({ where: { id: issue.id, organizationId: orgId } }),
    );
    expect(challan.status).toBe('issued');
    const prefill = await getReceivePrefill(orgId, step1.id);
    expect(prefill.lines).toHaveLength(1);

    // The step has received nothing…
    const totals = await runAsTenant(orgId, (tx) => getStepTotals(tx, orgId, step1.id));
    expect(totals.receivedQty.toString()).toBe('0');
    expect(totals.receiptCount).toBe(0);

    // 🔴 …so the chain guard still refuses step 2. A receipt somebody typed and
    // parked must not unlock the next operation.
    const blocked = await runAsTenant(orgId, (tx) =>
      chainNotReady(tx, orgId, step2.jobOrderId, { id: step2.id, seq: step2.seq }),
    );
    expect(blocked).toMatch(/Nothing has come back/);
  });

  it('is deleted outright, taking its outputs and lines with it', async () => {
    const { batch, step1 } = await makeOrder();

    const issue = await createNewJobIssue(orgId, {
      jobOrderStepId: step1.id,
      sourceLocationId: godownId,
      lines: [{ itemId: greyId, batchId: batch.id, qty: 500 }],
    });

    const draft = await createNewJobReceipt(
      orgId,
      {
        jobOrderStepId: step1.id,
        issueIds: [issue.id],
        locationId: godownId,
        lines: [{ itemId: greyId, issuedQty: 500, receivedQty: 0 }],
        outputs: [{ itemId: dyedId, isPrimary: true, receivedQty: 500, acceptedQty: 500 }],
      },
      undefined,
      'draft',
    );

    await deleteJobReceiptDraft(orgId, draft.id);

    const gone = await runAsTenant(orgId, (tx) =>
      tx.jobReceipt.findFirstOrThrow({ where: { id: draft.id, organizationId: orgId } }),
    );
    expect(gone.isDeleted).toBe(true);
    const outputs = await runAsTenant(orgId, (tx) =>
      tx.jobReceiptOutput.count({ where: { organizationId: orgId, jobReceiptId: draft.id } }),
    );
    expect(outputs).toBe(0);
  });
});
