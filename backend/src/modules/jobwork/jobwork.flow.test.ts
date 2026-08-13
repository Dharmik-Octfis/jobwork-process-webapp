import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../db/prisma.ts';
import {
  createBatch,
  getBalance,
  postMovement,
} from '../inventory/stock-ledger/stockLedger.service.ts';
import { SOURCE_DOC_TYPES, runAsDocument } from './jobwork.types.ts';
import { createNewProcess } from './processes/processes.service.ts';
import { createNewRoute, updateRouteById } from './process-routes/processRoutes.service.ts';
import {
  appendJobOrderSteps,
  createNewJobOrder,
  getJobOrderById,
  getJobOrderOverview,
  shortCloseJobOrder,
  updateJobOrderById,
} from './job-orders/jobOrders.service.ts';
import { createNewJobIssue } from './issues/jobIssues.service.ts';
import { getStepTotals } from './job-orders/jobOrders.status.ts';
import { createNewJobReceipt, getReceivePrefill } from './receipts/jobReceipts.service.ts';
import type { ProcessorType } from './jobwork.types.ts';

/**
 * 🔴 THE WHOLE LOOP, END TO END — the plan's own "done means" for Sprint 4:
 *
 *   issue 5,000 m → receive 4,850 m of a DIFFERENT item in a DIFFERENT unit →
 *   reject some → re-issue as rework → receive it → the traceability chain from
 *   the output batch back to the input batch is intact.
 *
 * It is one test rather than five because the failure this guards against is not
 * "does createJobIssue work" — each service already has its own guards — it is
 * the chain coming apart between them: a step status that stops advancing, a
 * batch whose parents were never written, a balance that survives one document and
 * not two. Those only appear when the documents run in sequence against the same
 * data.
 *
 * 🔴 Every row here is created by this file and hard-deleted afterwards. Suites
 * run against the dev database IN PARALLEL, so a test that mutated an org, item
 * or vendor it merely *found* would break whatever another suite was doing with
 * it at that moment (CLAUDE.md). Nothing here reads pre-existing data.
 */

const unique = () => process.hrtime.bigint().toString(36);

/**
 * 🔴 STOCK, PUT ON THE BOOKS THE WAY PURCHASE RECEIVED WILL DO IT.
 *
 * `createBatch` + `postMovement` through the ledger service and nothing else — the
 * exact path `PURCHASE_RECEIVED_AND_ITEMS_SPEC.md` §4.7 specifies. Material In on
 * the job order used to do this and was retired on 2026-08-07 (§D3), so a job
 * order is now a PLAN and the stock it draws on arrives from somewhere else.
 *
 * Writing it here rather than through a document is what lets these tests keep
 * covering the loop while Purchase Received is still unbuilt.
 */
async function seedStock(itemId: string, qty: number, opts: { value?: number } = {}) {
  // runAsDocument, not runAsTenant: a document posts several movements and the
  // 5-second default is tight (jobwork.types.ts).
  return runAsDocument(orgId, async (tx) => {
    const batch = await createBatch(tx, {
      organizationId: orgId,
      itemId,
      ownership: 'own',
      sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
    });

    await postMovement(tx, {
      organizationId: orgId,
      batchId: batch.id,
      locationId: godownId,
      movementType: 'receipt',
      qtyIn: qty,
      valueIn: opts.value ?? 0,
      sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
      sourceDocId: batch.id,
    });

    return batch;
  });
}

let orgId: string;
let greyId: string;
let dyedId: string;
let shirtId: string;
let metreId: string;
let pieceId: string;
let godownId: string;
let dyerId: string;
let cutterId: string;

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `jobwork-flow-${unique()}`, orgCode: String(Date.now()).slice(-10) },
    select: { id: true },
  });
  orgId = org.id;

  await runAsTenant(orgId, async (tx) => {
    const metre = await tx.unitOfMeasurement.create({
      data: { organizationId: orgId, unitName: 'Metre', symbol: 'MTR' },
      select: { id: true },
    });
    metreId = metre.id;

    const piece = await tx.unitOfMeasurement.create({
      data: { organizationId: orgId, unitName: 'Piece', symbol: 'PCS' },
      select: { id: true },
    });
    pieceId = piece.id;

    // Three items, because the point of the domain is that the thing coming back
    // can be a DIFFERENT item in a DIFFERENT unit (§5.1) — never a conversion
    // factor applied to one item.
    const grey = await tx.item.create({
      data: {
        organizationId: orgId,
        name: 'Grey Fabric',
        sku: `FLOW-GREY-${unique()}`,
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
        sku: `FLOW-DYED-${unique()}`,
        unit: 'Metre',
        stockingUomId: metreId,
        inventoryTracking: 'batch',
      },
      select: { id: true },
    });
    dyedId = dyed.id;

    const shirt = await tx.item.create({
      data: {
        organizationId: orgId,
        name: 'Cut Shirt Panels',
        sku: `FLOW-SHIRT-${unique()}`,
        unit: 'Piece',
        stockingUomId: pieceId,
        inventoryTracking: 'none',
      },
      select: { id: true },
    });
    shirtId = shirt.id;

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

    const cutter = await tx.vendor.create({
      data: {
        organizationId: orgId,
        contactName: 'Precision Cutting',
        contactNumber: `VEN-${unique()}`,
        vendorTypes: ['job_worker'],
      },
      select: { id: true },
    });
    cutterId = cutter.id;
  });
});

afterAll(async () => {
  // Bottom-up. `stock_ledger` holds RESTRICT foreign keys to items, batches and
  // locations, so letting the organization cascade would hit those constraints in
  // whatever order Postgres chose.
  await runAsTenant(orgId, async (tx) => {
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
    await tx.rejectionReason.deleteMany({ where: { organizationId: orgId } });
    await tx.stockLedgerEntry.deleteMany({ where: { organizationId: orgId } });
    await tx.batch.deleteMany({ where: { organizationId: orgId } });
    await tx.process.deleteMany({ where: { organizationId: orgId } });
    await tx.item.deleteMany({ where: { organizationId: orgId } });
    await tx.location.deleteMany({ where: { organizationId: orgId } });
    await tx.vendor.deleteMany({ where: { organizationId: orgId } });
    await tx.unitOfMeasurement.deleteMany({ where: { organizationId: orgId } });
    await tx.numberSequence.deleteMany({ where: { organizationId: orgId } });
  });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

/**
 * The timeout is explicit because vitest's default is 5 s and the first test
 * takes about a minute. It is not slow code: fifty takas means fifty packages,
 * fifty movements, fifty issue lines, fifty receipt lines and forty-eight output
 * packages, each its own round trip to the shared dev database. Shrinking the
 * consignment to make it fit would delete the only test that exercises unit-wise
 * receipt at a realistic size.
 */
describe('jobwork — the full loop', { timeout: 120_000 }, () => {
  it('runs grey → dyeing → cutting, with rework, and keeps the chain intact', async () => {
    // ---------------------------------------------------------------------
    // Masters
    // ---------------------------------------------------------------------
    const dyeing = await createNewProcess(orgId, {
      name: 'Dyeing',
      // The same roll comes back, so goods can be received taka by taka.
      rateBasis: 'per_issued_unit',
      defaultTolerancePct: 5,
    });

    const cutting = await createNewProcess(orgId, {
      name: 'Cutting',
      // Cloth in, panels out — a different item in a different unit.
      itemChanges: true,
      // The roll is destroyed, so only a bulk quantity can be received.
      rateBasis: 'per_received_unit',
    });

    const route = await createNewRoute(orgId, {
      name: 'Grey to panels',
      steps: [
        {
          processId: dyeing.id,
          processorId: dyerId,
          rate: 12,
          inputs: [{ itemId: greyId }],
          outputs: [{ itemId: dyedId, isPrimary: true }],
          tolerancePct: 5,
        },
        {
          processId: cutting.id,
          processorId: cutterId,
          rate: 4,
          inputs: [{ itemId: dyedId }],
          outputs: [{ itemId: shirtId, isPrimary: true }],
          expectedYield: 0.6,
        },
      ],
    });
    expect(route.steps).toHaveLength(2);

    // ---------------------------------------------------------------------
    // The stock this run draws on. Purchase Received will write this; until it
    // ships the test writes it through the same ledger calls (§4.7).
    // ---------------------------------------------------------------------
    const inputBatch = await seedStock(greyId, 5000, { value: 250000 });

    // ---------------------------------------------------------------------
    // The job order — a PLAN, with no item and no quantity on the header. A
    // step consumes a SET of items, so what this run is made of is step 1's
    // own CONSUMES list.
    // ---------------------------------------------------------------------
    const jobOrder = await createNewJobOrder(orgId, {
      routeId: route.id,
      // What the Create form does when a route is picked: copy the steps once,
      // then let go. `processorType` is a plain string on the row and a union on
      // the input — the client sends back what it displayed, and the service
      // re-validates it.
      steps: route.steps.map((step, index) => ({
        processId: step.processId,
        processorType: step.processorType as ProcessorType,
        processorId: step.processorId,
        rate: step.rate === null ? null : Number(step.rate),
        rateBasis: step.rateBasis as 'per_issued_unit' | 'per_received_unit' | null,
        inputs: step.inputs.map((row) => ({ itemId: row.itemId })),
        outputs: step.outputs.map((row) => ({ itemId: row.itemId, isPrimary: row.isPrimary })),
        expectedYield: step.expectedYield === null ? null : Number(step.expectedYield),
        tolerancePct: step.tolerancePct === null ? null : Number(step.tolerancePct),
        // The quantity is per item now; step 1's principal row carries the run.
        plannedInputQty: index === 0 ? 5000 : null,
      })),
    });

    expect(jobOrder.jobOrderNumber).toMatch(/^JO-\d{5}$/);
    // 🔴 The route's NAME is frozen; the route itself is never read again.
    expect(jobOrder.routeNameSnapshot).toBe('Grey to panels');
    expect(jobOrder.steps).toHaveLength(2);
    expect(jobOrder.steps[0]!.processNameSnapshot).toBe('Dyeing');
    // The compat bridge: a client that sends no lists still gets one input row
    // and one output row, derived from the scalars they replaced (§5.7). This is
    // what lets Sprint 5 ship before the step grid grows its nested lists.
    expect(jobOrder.steps[0]!.inputs.map((row) => row.itemId)).toEqual([greyId]);
    expect(jobOrder.steps[0]!.outputs.map((row) => row.itemId)).toEqual([dyedId]);
    expect(jobOrder.steps[0]!.outputs[0]!.isPrimary).toBe(true);
    // Step 1 plans the order's quantity; step 2 plans what step 1 should yield.
    expect(Number(jobOrder.steps[0]!.plannedInputQty)).toBe(5000);
    expect(Number(jobOrder.steps[1]!.plannedInputQty)).toBe(5000);

    // On the books, valued.
    const opening = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId: inputBatch.id }),
    );
    expect(opening.qty.toString()).toBe('5000');
    expect(opening.value.toString()).toBe('250000');

    // ---------------------------------------------------------------------
    // Step 1 — issue to the dyer, taka by taka
    // ---------------------------------------------------------------------
    const step1 = jobOrder.steps[0]!;
    const issue = await createNewJobIssue(orgId, {
      jobOrderStepId: step1.id,
      sourceLocationId: godownId,
      // ⚠️ Batch level. The whole batch goes as one line — the fifty takas are still
      // recorded against the batch, but a challan does not name them one by one.
      lines: [{ itemId: greyId, batchId: inputBatch.id, qty: 5000 }],
    });

    expect(issue.challanNumber).toMatch(/^JI-\d{5}$/);
    expect(Number(issue.totalQty)).toBe(5000);
    // 🔴 The processor's location was created on first use — nobody had to set
    // one up before they could send anything (§5.1).
    expect(issue.destinationLocationId).not.toBe(godownId);
    // The party details are FROZEN on the challan, not joined at print time.
    expect(issue.processorNameSnapshot).toBe('Sunrise Dyers Pvt Ltd');

    // Stock left the godown and is now at the dyer — one axis, not a separate
    // "with processor" state (§5.4).
    const atGodown = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId: inputBatch.id, locationId: godownId }),
    );
    expect(atGodown.qty.toString()).toBe('0');
    const atDyer = await runAsTenant(orgId, (tx) =>
      getBalance(tx, {
        organizationId: orgId,
        batchId: inputBatch.id,
        locationId: issue.destinationLocationId,
      }),
    );
    expect(atDyer.qty.toString()).toBe('5000');
    // Value travelled with the quantity, so our goods at the dyer are not
    // suddenly worthless.
    expect(atDyer.value.toString()).toBe('250000');

    // ---------------------------------------------------------------------
    // Step 1 — receive back, at BATCH level. Goods come back as a quantity
    // against the item; there is no taka-by-taka grid today.
    // ---------------------------------------------------------------------
    const prefill = await getReceivePrefill(orgId, step1.id);
    // One open challan line, because the challan itself is batch-level now.
    expect(prefill.lines).toHaveLength(1);

    // 4,850 m back out of 5,000 — and 50 m of that is shade-off and needs
    // redoing, which is what rework exists for.
    const receipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: step1.id,
      issueIds: [issue.id],
      locationId: godownId,
      lines: [{ itemId: greyId, issuedQty: 5000, receivedQty: 0 }],
      outputs: [
        {
          itemId: dyedId,
          isPrimary: true,
          receivedQty: 4850,
          acceptedQty: 4800,
          reworkQty: 50,
        },
      ],
    });

    expect(Number(receipt.totalReceivedQty)).toBe(4850);
    expect(Number(receipt.totalAcceptedQty)).toBe(4800);
    expect(Number(receipt.totalReworkQty)).toBe(50);
    // 🔴 The rework pieces are in a batch of their OWN, so they stay countable.
    expect(receipt.outputBatchId).not.toBeNull();
    expect(receipt.reworkBatchId).not.toBeNull();
    expect(receipt.outputBatchId).not.toBe(receipt.reworkBatchId);

    const dyedBatch = await runAsTenant(orgId, (tx) =>
      tx.batch.findFirstOrThrow({ where: { id: receipt.outputBatchId! } }),
    );
    // 🔴 GENEALOGY. Written here or never — it cannot be reconstructed from
    // history that was not recorded (§11.3).
    expect(dyedBatch.parentBatchIds).toContain(inputBatch.id);
    expect(dyedBatch.itemId).toBe(dyedId);

    // The cost of the material plus the dyeing charge landed on the pieces that
    // survived — 250,000 + (5,000 × 12) = 310,000, split by quantity.
    const dyedBalance = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId: dyedBatch.id }),
    );
    expect(dyedBalance.qty.toString()).toBe('4800');
    expect(Number(dyedBalance.value)).toBeCloseTo((310000 * 4800) / 4850, 0);

    // ---------------------------------------------------------------------
    // Rework — back to the SAME step, counted as a second attempt
    // ---------------------------------------------------------------------
    const reworkIssue = await createNewJobIssue(orgId, {
      jobOrderStepId: step1.id,
      sourceLocationId: godownId,
      isRework: true,
      lines: [{ batchId: receipt.reworkBatchId!, qty: 50 }],
    });
    expect(reworkIssue.isRework).toBe(true);
    expect(reworkIssue.attemptNo).toBeGreaterThan(1);

    // ---------------------------------------------------------------------
    // Step 2 — cutting. A different item, in a different unit, from a process
    // that destroys the packaging.
    // ---------------------------------------------------------------------
    const step2 = jobOrder.steps[1]!;
    const cutIssue = await createNewJobIssue(orgId, {
      jobOrderStepId: step2.id,
      sourceLocationId: godownId,
      lines: [{ batchId: dyedBatch.id, qty: 4800 }],
    });
    expect(Number(cutIssue.totalQty)).toBe(4800);

    // Cutting destroys the roll; goods come back as a quantity against the batch.
    const cutPrefill = await getReceivePrefill(orgId, step2.id);
    expect(cutPrefill.issues).toHaveLength(1);

    const cutReceipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: step2.id,
      issueIds: [cutIssue.id],
      locationId: godownId,
      // 2,850 PIECES out of 4,800 METRES — the units genuinely differ, and
      // nothing anywhere multiplied one by a yield to get the other.
      lines: [
        {
          issuedQty: 4800,
          receivedQty: 2850,
          acceptedQty: 2820,
          scrapQty: 30,
        },
      ],
    });

    const panelBatch = await runAsTenant(orgId, (tx) =>
      tx.batch.findFirstOrThrow({ where: { id: cutReceipt.outputBatchId! } }),
    );
    expect(panelBatch.itemId).toBe(shirtId);
    expect(panelBatch.uomId).toBe(pieceId);
    // The chain holds all the way back: panels → dyed → grey.
    expect(panelBatch.parentBatchIds).toContain(dyedBatch.id);
    expect(dyedBatch.parentBatchIds).toContain(inputBatch.id);

    // Scrap took no share of the value, so the surviving panels carry the full
    // cost of the run (§5.5) — which is the number anyone would quote from.
    const panelBalance = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId: panelBatch.id }),
    );
    expect(panelBalance.qty.toString()).toBe('2820');
    expect(Number(panelBalance.value)).toBeGreaterThan(0);

    // ---------------------------------------------------------------------
    // The Overview page's own numbers
    // ---------------------------------------------------------------------
    const overview = await getJobOrderOverview(orgId, jobOrder.id);
    expect(overview.steps).toHaveLength(2);

    /**
     * 50 still out on step 1 — the rework consignment, and only that.
     *
     * 5,050 was issued (5,000 plus the 50 m rework) and 5,000 of it has been
     * ACCOUNTED FOR by a receipt. The 150 m that dyeing lost is not "still out":
     * the receipt explains it, as 5,000 m consumed against 4,850 m returned. So
     * "outstanding" means material nobody has yet said anything about, which is
     * the only question the `[+ Receive]` button needs answered.
     *
     * 🔴 It is issued MINUS CONSUMED, both in metres. Subtracting the received
     * quantity would work here and be nonsense on step 2, where 2,850 pieces
     * came back against 4,800 metres.
     */
    expect(Number(overview.steps[0]!.totals.outstandingQty)).toBe(50);
    expect(overview.steps[1]!.status).toBe('completed');
    expect(overview.jobOrder.status).toBe('in_progress');

    // ---------------------------------------------------------------------
    // Closing short — the one status a human sets, and it is sticky
    // ---------------------------------------------------------------------
    const closed = await shortCloseJobOrder(orgId, jobOrder.id, 'Rework abandoned, party accepted');
    expect(closed.status).toBe('short_closed');
    expect(closed.remarks).toContain('Rework abandoned');

    const afterClose = await getJobOrderOverview(orgId, jobOrder.id);
    // A recompute must not quietly reopen it.
    expect(afterClose.jobOrder.status).toBe('short_closed');
  });

  it('refuses to issue a second batch when the process demands one', async () => {
    const shadeMatched = await createNewProcess(orgId, {
      name: `Shade-matched dyeing ${unique()}`,
      requiresSingleBatch: true,
    });

    // Two separate batches of the same item at the same place.
    const batchA = await seedStock(greyId, 100);
    const batchB = await seedStock(greyId, 100);
    const batches = [batchA, batchB];

    const jobOrder = await createNewJobOrder(orgId, {
      steps: [
        {
          processId: shadeMatched.id,
          processorId: dyerId,
          inputs: [{ itemId: greyId, plannedQty: 200 }],
        },
      ],
    });

    await expect(
      createNewJobIssue(orgId, {
        jobOrderStepId: jobOrder.steps[0]!.id,
        sourceLocationId: godownId,
        lines: batches.map((batch) => ({ batchId: batch.id, qty: 50 })),
      }),
      // Shade variation is invisible until the garment is assembled, which is
      // why this is a block and not a warning (§5.4).
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a disposition split that does not add up', async () => {
    const process = await createNewProcess(orgId, { name: `Split check ${unique()}` });
    const batch = await seedStock(greyId, 100);
    const jobOrder = await createNewJobOrder(orgId, {
      steps: [
        {
          processId: process.id,
          processorId: dyerId,
          inputs: [{ itemId: greyId, plannedQty: 100 }],
        },
      ],
    });

    const issue = await createNewJobIssue(orgId, {
      jobOrderStepId: jobOrder.steps[0]!.id,
      sourceLocationId: godownId,
      lines: [{ batchId: batch.id, qty: 100 }],
    });

    await expect(
      createNewJobReceipt(orgId, {
        jobOrderStepId: jobOrder.steps[0]!.id,
        issueIds: [issue.id],
        locationId: godownId,
        // 90 received, but only 80 accounted for. The missing 10 is exactly the
        // kind of gap a separate rejection note would have hidden.
        lines: [{ issuedQty: 100, receivedQty: 90, acceptedQty: 80 }],
      }),
    ).rejects.toBeTruthy();
  });
});

/**
 * 🔴 MULTI-ITEM STEPS — a set of items in, a set of items out (domain §5.7).
 *
 * Stitching takes panels AND thread AND buttons and returns shirts AND rejects.
 * Sprints 1–4 could only name one of each, and these are the rules that replaced
 * that: the lists themselves, the per-item plan, and the chain becoming a
 * classification rather than a rule (§6.4).
 *
 * Everything here stops at the job order. Issuing two of three items on one
 * challan and consuming all three on one receipt are steps 4 and 5 of the plan's
 * §12.1 and are guarded where they land.
 */
describe('jobwork — multi-item steps', { timeout: 60_000 }, () => {
  let coneId: string;
  let threadId: string;
  let buttonId: string;
  let shirtsId: string;
  let rejectsId: string;
  let offcutsId: string;

  beforeAll(async () => {
    await runAsTenant(orgId, async (tx) => {
      const cone = await tx.unitOfMeasurement.create({
        data: { organizationId: orgId, unitName: `Cone ${unique()}`, symbol: 'CONE' },
        select: { id: true },
      });
      coneId = cone.id;

      const make = async (name: string, unit: string, uomId: string) => {
        const item = await tx.item.create({
          data: {
            organizationId: orgId,
            name,
            sku: `FLOW-${name.toUpperCase().replace(/\W+/g, '')}-${unique()}`,
            unit,
            stockingUomId: uomId,
            inventoryTracking: 'none',
          },
          select: { id: true },
        });
        return item.id;
      };

      threadId = await make('Thread', 'Cone', coneId);
      buttonId = await make('Buttons', 'Piece', pieceId);
      shirtsId = await make('Stitched Shirts', 'Piece', pieceId);
      rejectsId = await make('Reject Shirts', 'Piece', pieceId);
      offcutsId = await make('Fabric Offcuts', 'Metre', metreId);
    });
  });

  it('consumes three items and produces two, in three different units', async () => {
    const stitching = await createNewProcess(orgId, {
      name: `Stitching ${unique()}`,
      itemChanges: true,
    });

    const jobOrder = await createNewJobOrder(orgId, {
      steps: [
        {
          processId: stitching.id,
          processorId: cutterId,
          // 🔴 Everything the step consumes is listed here and nowhere else.
          // There is no header item to be quietly prepended any more.
          inputs: [
            { itemId: shirtId, plannedQty: 2910 },
            { itemId: threadId, plannedQty: 12 },
            { itemId: buttonId, plannedQty: 8700 },
          ],
          outputs: [
            { itemId: shirtsId, isPrimary: true, expectedQty: 2880 },
            { itemId: rejectsId },
          ],
        },
      ],
    });

    const step = jobOrder.steps[0]!;
    expect(step.inputs.map((row) => row.itemId)).toEqual([shirtId, threadId, buttonId]);
    expect(step.inputs.map((row) => row.seq)).toEqual([1, 2, 3]);

    // 🔴 Each row transacts in ITS OWN item's stocking unit — 2,910 PCS, 12 CONE,
    // 8,700 PCS. Nothing here converts between them and nothing can (§5.1).
    expect(step.inputs.map((row) => row.uomId)).toEqual([pieceId, coneId, pieceId]);
    expect(Number(step.inputs[0]!.plannedQty)).toBe(2910);
    expect(Number(step.inputs[1]!.plannedQty)).toBe(12);
    expect(Number(step.inputs[2]!.plannedQty)).toBe(8700);

    // Nothing above this step produces any of them, so all three come from the
    // godown. That is a label, never a rejection (§6.4).
    expect(step.inputs.every((row) => row.fromStock)).toBe(true);

    expect(step.outputs.map((row) => row.itemId)).toEqual([shirtsId, rejectsId]);
    // 🔴 Exactly one primary — the output that absorbs the step's whole cost
    // (§9.2.1). The rejects are a by-product and take an explicit value later.
    expect(step.outputs.filter((row) => row.isPrimary)).toHaveLength(1);
    expect(step.outputs[0]!.isPrimary).toBe(true);
    expect(Number(step.outputs[0]!.expectedQty)).toBe(2880);
    // A by-product gets NO guessed quantity. How many will fail inspection is
    // not something a plan can derive from a yield.
    expect(step.outputs[1]!.expectedQty).toBeNull();

    // The principal input and primary output are read off the LISTS now — the
    // four scalar columns that mirrored them went with Migration B (2026-08-12).
    expect(step.inputs[0]!.itemId).toBe(shirtId);
    expect(step.inputs[0]!.uomId).toBe(pieceId);
    expect(step.outputs.find((row) => row.isPrimary)!.itemId).toBe(shirtsId);
    expect(Number(step.plannedInputQty)).toBe(2910);
  });

  it('carries a default quantity on a route’s CONSUMES rows, and copies it into a job order', async () => {
    const stitching = await createNewProcess(orgId, {
      name: `Stitching template ${unique()}`,
      itemChanges: true,
    });

    const route = await createNewRoute(orgId, {
      name: `Shirts from panels ${unique()}`,
      steps: [
        {
          processId: stitching.id,
          inputs: [
            { itemId: shirtId, plannedQty: 2910 },
            { itemId: threadId, plannedQty: 12 },
          ],
          // 🔴 A quantity sent on an OUTPUT is dropped, not stored. What comes
          // back is a per-run answer; only the consumed side has a default.
          outputs: [{ itemId: shirtsId, isPrimary: true, plannedQty: 2880 }],
        },
      ],
    });

    const routeStep = route.steps[0]!;
    expect(Number(routeStep.inputs[0]!.plannedQty)).toBe(2910);
    expect(Number(routeStep.inputs[1]!.plannedQty)).toBe(12);
    expect(routeStep.outputs[0]).not.toHaveProperty('plannedQty');

    // What the Create form does when a route is picked: copy the rows once and
    // let go (§2.4). The default becomes the order's plan, editable from here.
    const jobOrder = await createNewJobOrder(orgId, {
      routeId: route.id,
      steps: route.steps.map((step) => ({
        processId: step.processId,
        inputs: step.inputs.map((row) => ({
          itemId: row.itemId,
          plannedQty: row.plannedQty === null ? null : Number(row.plannedQty),
        })),
        outputs: step.outputs.map((row) => ({
          itemId: row.itemId,
          isPrimary: row.isPrimary,
        })),
      })),
    });

    const step = jobOrder.steps[0]!;
    expect(Number(step.inputs[0]!.plannedQty)).toBe(2910);
    expect(Number(step.inputs[1]!.plannedQty)).toBe(12);
    // The principal row's quantity IS the step's plan — one number, not two.
    expect(Number(step.plannedInputQty)).toBe(2910);
    // The copied default reaches the output side too, but by the JOB ORDER's own
    // rule, not the route's: the primary output is planned from the principal
    // input times the yield (`planQuantities`), which with no yield is 1:1. The
    // route still said nothing about what comes back.
    expect(Number(step.outputs[0]!.expectedQty)).toBe(2910);

    // Editing the route afterwards cannot reach the order that copied it.
    await updateRouteById(orgId, route.id, {
      name: route.name,
      steps: [
        {
          processId: stitching.id,
          inputs: [{ itemId: shirtId, plannedQty: 99 }],
          outputs: [{ itemId: shirtsId, isPrimary: true }],
        },
      ],
    });
    const after = await getJobOrderById(orgId, jobOrder.id);
    expect(Number(after!.steps[0]!.inputs[0]!.plannedQty)).toBe(2910);
  });

  it('labels a chain-fed input, and plans it from what the step above produces', async () => {
    const cutting = await createNewProcess(orgId, {
      name: `Cutting ${unique()}`,
      itemChanges: true,
    });
    const stitching = await createNewProcess(orgId, {
      name: `Stitching ${unique()}`,
      itemChanges: true,
    });

    const jobOrder = await createNewJobOrder(orgId, {
      steps: [
        {
          processId: cutting.id,
          processorId: cutterId,
          expectedYield: 0.6,
          inputs: [{ itemId: dyedId, plannedQty: 4800 }],
          outputs: [{ itemId: shirtId, isPrimary: true }, { itemId: offcutsId }],
        },
        {
          processId: stitching.id,
          processorId: cutterId,
          inputs: [{ itemId: shirtId }, { itemId: threadId }],
          outputs: [{ itemId: shirtsId, isPrimary: true }],
        },
      ],
    });

    const [cut, stitch] = jobOrder.steps;
    // 4,800 m × 0.6 — the yield plans the primary output and nothing else.
    expect(Number(cut!.outputs[0]!.expectedQty)).toBe(2880);
    expect(cut!.outputs[1]!.expectedQty).toBeNull();

    // 🔴 The panels come from the step above; the thread comes from the godown.
    // Both save. That is the whole of §6.4.
    expect(stitch!.inputs[0]!.itemId).toBe(shirtId);
    expect(stitch!.inputs[0]!.fromStock).toBe(false);
    expect(Number(stitch!.inputs[0]!.plannedQty)).toBe(2880);
    expect(stitch!.inputs[1]!.itemId).toBe(threadId);
    expect(stitch!.inputs[1]!.fromStock).toBe(true);
    // No bill of materials exists, so how much thread is left blank rather than
    // guessed. A guessed number reads as an estimate somebody made.
    expect(stitch!.inputs[1]!.plannedQty).toBeNull();
  });

  /**
   * 🔴 The regression guard for 2026-08-11: step ORDER is no longer refused.
   *
   * This save used to 400 with "Material cannot come from a step that has not run
   * yet — reorder the steps", which threw away a whole document over an
   * arrangement the grid itself invites. Nothing above step 1 produces panels, so
   * they are drawn from stock — the same answer the classifier gives thread.
   */
  it('saves an input only a later step produces, drawn from stock', async () => {
    const cutting = await createNewProcess(orgId, {
      name: `Cutting ${unique()}`,
      itemChanges: true,
    });
    const stitching = await createNewProcess(orgId, {
      name: `Stitching ${unique()}`,
      itemChanges: true,
    });

    const jobOrder = await createNewJobOrder(orgId, {
      steps: [
        {
          processId: stitching.id,
          processorId: cutterId,
          inputs: [{ itemId: shirtId }],
          outputs: [{ itemId: shirtsId, isPrimary: true }],
        },
        {
          processId: cutting.id,
          processorId: cutterId,
          outputs: [{ itemId: shirtId, isPrimary: true }],
        },
      ],
    });

    expect(jobOrder.steps[0]!.inputs[0]!.itemId).toBe(shirtId);
    expect(jobOrder.steps[0]!.inputs[0]!.fromStock).toBe(true);
    // No ceiling to plan against either — a later step's output is not a supply.
    expect(jobOrder.steps[0]!.inputs[0]!.plannedQty).toBeNull();
  });

  /**
   * 🔴 THE EXPECTED QUANTITY IS DERIVED ONLY WHERE THERE IS A BASIS (§6.3).
   *
   * It used to be `plannedQty × (yield ?? 1)` unconditionally, and with yield off
   * the grid that meant 1:1 — so cutting 4,800 M of fabric planned 4,800 PCS of
   * panels. Metres and pieces have no ratio, and the invented figure did not stay
   * put: it became the next step's planned input, which is what its tolerance
   * ceiling is computed from.
   */
  it('derives an expected quantity only from a stated yield or a matching unit', async () => {
    const cutting = await createNewProcess(orgId, {
      name: `Cutting ${unique()}`,
      itemChanges: true,
    });
    const washing = await createNewProcess(orgId, {
      name: `Washing ${unique()}`,
      itemChanges: false,
    });

    const jobOrder = await createNewJobOrder(orgId, {
      steps: [
        // MTR in, PCS out, nobody stated a ratio. There is no answer, so none is
        // invented — and the step below has nothing to plan from, which is the
        // truth rather than a wrong number.
        {
          processId: cutting.id,
          processorId: cutterId,
          inputs: [{ itemId: dyedId, plannedQty: 4800 }],
          outputs: [{ itemId: shirtId, isPrimary: true }],
        },
        // PCS in, PCS out — 1:1 is the honest default.
        {
          processId: washing.id,
          processorId: cutterId,
          inputs: [{ itemId: shirtId, plannedQty: 2880 }],
          outputs: [{ itemId: shirtsId, isPrimary: true }],
        },
      ],
    });

    expect(jobOrder.steps[0]!.outputs[0]!.expectedQty).toBeNull();
    expect(Number(jobOrder.steps[1]!.outputs[0]!.expectedQty)).toBe(2880);

    // A stated yield IS the conversion, so it answers across units.
    const withYield = await createNewJobOrder(orgId, {
      steps: [
        {
          processId: cutting.id,
          processorId: cutterId,
          expectedYield: 0.6,
          inputs: [{ itemId: dyedId, plannedQty: 4800 }],
          outputs: [{ itemId: shirtId, isPrimary: true }],
        },
      ],
    });
    expect(Number(withYield.steps[0]!.outputs[0]!.expectedQty)).toBe(2880);
  });

  /**
   * 🔴 The balance is a RUNNING one, and it is a DERIVATION, not a gate (§6.4.0).
   *
   * Two steps can both draw on step 1's panels, and the second is planned at what
   * the first left. Overwriting per producer — what this used to do — would hand
   * the same 90 out twice and plan 180 panels off a step that cuts 90.
   *
   * And over-planning SAVES. Refusing it was wrong for an ordinary case: the
   * difference legitimately comes from stock. The client says so on the row; the
   * hard gates stay at issue time.
   */
  it('shares one step’s output between later steps, and saves an over-plan anyway', async () => {
    const cutting = await createNewProcess(orgId, {
      name: `Cutting ${unique()}`,
      itemChanges: true,
    });
    const stitching = await createNewProcess(orgId, {
      name: `Stitching ${unique()}`,
      itemChanges: true,
    });

    const shared = await createNewJobOrder(orgId, {
      steps: [
        {
          processId: cutting.id,
          processorId: cutterId,
          inputs: [{ itemId: dyedId, plannedQty: 100 }],
          outputs: [{ itemId: shirtId, isPrimary: true, expectedQty: 90 }],
        },
        {
          processId: stitching.id,
          processorId: cutterId,
          inputs: [{ itemId: shirtId, plannedQty: 60 }],
          outputs: [{ itemId: shirtsId, isPrimary: true }],
        },
        // Blank, so it is planned at what step 2 LEFT — 30, not the 90 cutting
        // returned. The whole point of a running balance.
        {
          processId: stitching.id,
          processorId: cutterId,
          inputs: [{ itemId: shirtId }],
          outputs: [{ itemId: offcutsId, isPrimary: true }],
        },
      ],
    });
    expect(Number(shared.steps[2]!.inputs[0]!.plannedQty)).toBe(30);

    // 120 panels off a step that cuts 90 — a plan somebody may well mean, because
    // 30 are already in the godown. Saved, with the note left to the client.
    const over = await createNewJobOrder(orgId, {
      steps: [
        {
          processId: cutting.id,
          processorId: cutterId,
          inputs: [{ itemId: dyedId, plannedQty: 100 }],
          outputs: [{ itemId: shirtId, isPrimary: true, expectedQty: 90 }],
        },
        {
          processId: stitching.id,
          processorId: cutterId,
          inputs: [{ itemId: shirtId, plannedQty: 120 }],
          outputs: [{ itemId: shirtsId, isPrimary: true }],
        },
      ],
    });
    expect(Number(over.steps[1]!.inputs[0]!.plannedQty)).toBe(120);
    expect(over.steps[1]!.inputs[0]!.fromStock).toBe(false);
  });

  /**
   * Stock, made the only way Sprints 2–4 can make it: a job order's own Material
   * In (§1.3). Purchase Received is descoped, so a feeder order is how thread and
   * buttons get onto the books at all.
   */
  const stockUp = (itemId: string, qty: number, value?: number) =>
    seedStock(itemId, qty, { value });

  it('carries two items on one challan and the third on another', async () => {
    const stitching = await createNewProcess(orgId, {
      name: `Stitching ${unique()}`,
      itemChanges: true,
    });

    await stockUp(threadId, 20);
    await stockUp(buttonId, 900);

    await stockUp(shirtId, 100);
    const jobOrder = await createNewJobOrder(orgId, {
      steps: [
        {
          processId: stitching.id,
          processorId: cutterId,
          inputs: [
            { itemId: shirtId, plannedQty: 100 },
            { itemId: threadId, plannedQty: 5 },
            { itemId: buttonId, plannedQty: 300 },
          ],
          outputs: [{ itemId: shirtsId, isPrimary: true }],
        },
      ],
    });
    const step = jobOrder.steps[0]!;

    const batchOf = async (itemId: string) =>
      runAsTenant(orgId, (tx) =>
        tx.batch.findFirstOrThrow({
          where: { organizationId: orgId, itemId, isDeleted: false },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        }),
      );
    const panelBatch = await batchOf(shirtId);
    const threadBatch = await batchOf(threadId);
    const buttonBatch = await batchOf(buttonId);

    // 🔴 ONE physical movement to one processor is ONE document, whatever the
    // bill of materials says (§5.7). Splitting it per item would multiply the
    // paperwork and let two step statuses disagree about whether stitching began.
    const first = await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      lines: [
        { itemId: shirtId, batchId: panelBatch.id, qty: 100 },
        { itemId: threadId, batchId: threadBatch.id, qty: 5 },
      ],
    });
    expect(first.lines).toHaveLength(2);
    expect(first.lines.map((line) => line.itemId).sort()).toEqual([shirtId, threadId].sort());
    // 🔴 The header names NO item since 2026-08-12. It used to carry the
    // principal one, which on this two-item challan named the panels and hid the
    // thread entirely.

    const second = await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      lines: [{ itemId: buttonId, batchId: buttonBatch.id, qty: 300 }],
    });
    expect(second.lines[0]!.itemId).toBe(buttonId);

    const totals = await runAsTenant(orgId, (tx) => getStepTotals(tx, orgId, step.id));
    const issuedOf = (itemId: string) =>
      Number(totals.perItem.find((row) => row.itemId === itemId)?.issuedQty ?? 0);
    // 🔴 Three items, three units, three separate numbers. 100 + 5 + 300 is 405
    // of nothing.
    expect(issuedOf(shirtId)).toBe(100);
    expect(issuedOf(threadId)).toBe(5);
    expect(issuedOf(buttonId)).toBe(300);

    // Nothing has come back, so the step is `issued` — and it cannot reach
    // `completed` until every one of the three is accounted for (§6.5).
    const overview = await getJobOrderOverview(orgId, jobOrder.id);
    expect(overview.steps[0]!.status).toBe('issued');
  });

  it('measures the tolerance ceiling against each item’s own plan', async () => {
    const stitching = await createNewProcess(orgId, {
      name: `Stitching ${unique()}`,
      itemChanges: true,
    });

    await stockUp(threadId, 20);

    await stockUp(shirtId, 100);
    const jobOrder = await createNewJobOrder(orgId, {
      steps: [
        {
          processId: stitching.id,
          processorId: cutterId,
          inputs: [
            { itemId: shirtId, plannedQty: 100 },
            { itemId: threadId, plannedQty: 5 },
          ],
          outputs: [{ itemId: shirtsId, isPrimary: true }],
          tolerancePct: 0,
        },
      ],
    });
    const step = jobOrder.steps[0]!;

    const threadBatch = await runAsTenant(orgId, (tx) =>
      tx.batch.findFirstOrThrow({
        where: { organizationId: orgId, itemId: threadId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
    );

    // 🔴 8 cones against a plan of 5. A single challan-wide ceiling would have
    // compared this against the 100 pieces of panel planned beside it and let it
    // through.
    await expect(
      createNewJobIssue(orgId, {
        jobOrderStepId: step.id,
        sourceLocationId: godownId,
        lines: [{ itemId: threadId, batchId: threadBatch.id, qty: 8 }],
      }),
    ).rejects.toMatchObject({ status: 400 });

    // The same issue goes through once somebody owns the decision.
    const forced = await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      toleranceOverrideReason: 'Extra thread for a second colour',
      lines: [{ itemId: threadId, batchId: threadBatch.id, qty: 8 }],
    });
    expect(forced.lines[0]!.itemId).toBe(threadId);
  });

  it('refuses a line whose item the step does not consume', async () => {
    const stitching = await createNewProcess(orgId, {
      name: `Stitching ${unique()}`,
      itemChanges: true,
    });

    await stockUp(threadId, 20);

    await stockUp(shirtId, 100);
    const jobOrder = await createNewJobOrder(orgId, {
      steps: [
        {
          processId: stitching.id,
          processorId: cutterId,
          inputs: [{ itemId: shirtId, plannedQty: 100 }],
          outputs: [{ itemId: shirtsId, isPrimary: true }],
        },
      ],
    });

    const threadBatch = await runAsTenant(orgId, (tx) =>
      tx.batch.findFirstOrThrow({
        where: { organizationId: orgId, itemId: threadId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
    );

    // The picker only offers what the step declared, so a line naming anything
    // else was hand-made — or the step was edited under an open dialog.
    await expect(
      createNewJobIssue(orgId, {
        jobOrderStepId: jobOrder.steps[0]!.id,
        sourceLocationId: godownId,
        lines: [{ itemId: threadId, batchId: threadBatch.id, qty: 5 }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  /**
   * 🔴 THE RULE THAT MAKES A BATCH-TRACKED ITEM MEAN ANYTHING.
   *
   * `inventoryTracking = 'batch'` is a promise that every metre can be traced back
   * to the roll it came off, and an issue is where that trace is created. A
   * batch-less line would have one invented for it by the scaffold in
   * `resolveLines` — a batch that traces to nothing, at a moment nobody can
   * reconstruct afterwards, because by then the goods are at the processor.
   *
   * The same test pins the other half: an item at `none` still goes out on a bare
   * quantity, because that is the whole point of the setting.
   */
  it('refuses a batch-less line for a batch-tracked item, and allows one for an untracked item', async () => {
    const stitching = await createNewProcess(orgId, {
      name: `Stitching ${unique()}`,
      itemChanges: true,
    });

    const dyedBatch = await stockUp(dyedId, 100);

    const jobOrder = await createNewJobOrder(orgId, {
      steps: [
        {
          processId: stitching.id,
          processorId: cutterId,
          // Dyed Fabric is `batch`; Cut Shirt Panels is `none`.
          inputs: [
            { itemId: dyedId, plannedQty: 100 },
            { itemId: shirtId, plannedQty: 50 },
          ],
          outputs: [{ itemId: shirtsId, isPrimary: true }],
        },
      ],
    });
    const stepId = jobOrder.steps[0]!.id;

    await expect(
      createNewJobIssue(orgId, {
        jobOrderStepId: stepId,
        sourceLocationId: godownId,
        lines: [{ itemId: dyedId, qty: 100 }],
      }),
    ).rejects.toMatchObject({
      status: 400,
      details: { 'lines.0.batchId': 'Pick a batch.' },
    });

    // Named batch for the tracked item, bare quantity for the untracked one —
    // one challan, and the untracked line still gets a batch minted for it.
    const issue = await createNewJobIssue(orgId, {
      jobOrderStepId: stepId,
      sourceLocationId: godownId,
      lines: [
        { itemId: dyedId, batchId: dyedBatch.id, qty: 100 },
        { itemId: shirtId, qty: 50 },
      ],
    });

    expect(issue.lines).toHaveLength(2);
    for (const line of issue.lines) expect(line.batchId).toBeTruthy();
  });

  it('consumes three items and returns two, with the value conserved', async () => {
    const stitching = await createNewProcess(orgId, {
      name: `Stitching ${unique()}`,
      itemChanges: true,
      // Stitching destroys the bundle, so goods come back as a bulk quantity.
      rateBasis: 'per_issued_unit',
    });

    await stockUp(threadId, 20);
    await stockUp(buttonId, 900);

    await stockUp(shirtId, 100, 1000);
    const jobOrder = await createNewJobOrder(orgId, {
      steps: [
        {
          processId: stitching.id,
          processorId: cutterId,
          // ₹3 per panel issued — 🔴 per PANEL, not per (panel + cone + button).
          rate: 3,
          rateBasis: 'per_issued_unit',
          inputs: [
            { itemId: shirtId, plannedQty: 100 },
            { itemId: threadId, plannedQty: 5 },
            { itemId: buttonId, plannedQty: 300 },
          ],
          outputs: [{ itemId: shirtsId, isPrimary: true }, { itemId: rejectsId }],
        },
      ],
    });
    const step = jobOrder.steps[0]!;

    const batchOf = async (itemId: string) =>
      runAsTenant(orgId, (tx) =>
        tx.batch.findFirstOrThrow({
          where: { organizationId: orgId, itemId, isDeleted: false },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        }),
      );
    const panelBatch = await batchOf(shirtId);
    const threadBatch = await batchOf(threadId);
    const buttonBatch = await batchOf(buttonId);

    const issue = await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      lines: [
        { itemId: shirtId, batchId: panelBatch.id, qty: 100 },
        { itemId: threadId, batchId: threadBatch.id, qty: 5 },
        { itemId: buttonId, batchId: buttonBatch.id, qty: 300 },
      ],
    });

    /**
     * 🔴 THREE ITEMS CONSUMED, TWO RETURNED, and the two sides are unrelated in
     * both length and unit. Every consumption line names its own item — without
     * that the bulk allocation would settle the panel line by eating the thread,
     * which is simply older.
     */
    const receipt = await createNewJobReceipt(orgId, {
      jobOrderStepId: step.id,
      issueIds: [issue.id],
      locationId: godownId,
      lines: [
        { itemId: shirtId, issuedQty: 100, receivedQty: 0 },
        { itemId: threadId, issuedQty: 5, receivedQty: 0 },
        { itemId: buttonId, issuedQty: 300, receivedQty: 0 },
      ],
      outputs: [
        { itemId: shirtsId, isPrimary: true, receivedQty: 92, acceptedQty: 92 },
        // A by-product with an explicit value — deducted from the primary's
        // share, never apportioned by quantity (§9.2.1).
        { itemId: rejectsId, receivedQty: 8, acceptedQty: 8, valueShare: 40 },
      ],
    });

    const outputs = await runAsTenant(orgId, (tx) =>
      tx.jobReceiptOutput.findMany({
        where: { organizationId: orgId, jobReceiptId: receipt.id },
        orderBy: { seq: 'asc' },
      }),
    );
    expect(outputs).toHaveLength(2);
    expect(outputs.filter((row) => row.isPrimary)).toHaveLength(1);
    // 🔴 A batch per returned item, each with genealogy back to EVERY batch consumed
    // — the rejects came from the same panels and thread the shirts did.
    expect(outputs[0]!.outputBatchId).not.toBeNull();
    expect(outputs[1]!.outputBatchId).not.toBeNull();
    expect(outputs[0]!.outputBatchId).not.toBe(outputs[1]!.outputBatchId);

    const shirtBatch = await runAsTenant(orgId, (tx) =>
      tx.batch.findFirstOrThrow({ where: { id: outputs[0]!.outputBatchId! } }),
    );
    expect(shirtBatch.itemId).toBe(shirtsId);
    for (const consumed of [panelBatch.id, threadBatch.id, buttonBatch.id]) {
      expect(shirtBatch.parentBatchIds).toContain(consumed);
    }

    /**
     * 🔴 VALUE IS CONSERVED (§9.2.1).
     *
     *   pot      = everything consumed + the process charge
     *   rejects  = the 40 somebody typed
     *   shirts   = pot − 40
     *
     * The charge is 100 panels × ₹3 — 🔴 keyed to the PRINCIPAL input. Against
     * the cross-item sum it would have been (100 + 5 + 300) × ₹3, which is 405
     * of nothing multiplied by a rate.
     */
    const balanceOf = async (batchId: string) =>
      runAsTenant(orgId, (tx) => getBalance(tx, { organizationId: orgId, batchId }));
    const shirtBalance = await balanceOf(outputs[0]!.outputBatchId!);
    const rejectBalance = await balanceOf(outputs[1]!.outputBatchId!);

    const consumedValue = 1000 + 0 + 0; // only the panels were valued
    const pot = consumedValue + 100 * 3;
    expect(Number(rejectBalance.value)).toBeCloseTo(40, 4);
    expect(Number(shirtBalance.value)).toBeCloseTo(pot - 40, 4);
    expect(Number(shirtBalance.value) + Number(rejectBalance.value)).toBeCloseTo(pot, 4);

    // The header's six totals are the PRIMARY output's, in its own unit — which
    // row that is comes off `isPrimary`, not from a header column any more.
    expect(receipt.outputs.find((row) => row.isPrimary)!.itemId).toBe(shirtsId);
    expect(Number(receipt.totalReceivedQty)).toBe(92);
    expect(Number(receipt.totalIssuedQty)).toBe(100);

    // 🔴 Every input accounted for → the step is finished. Had the thread been
    // left out, it would still be `partially_received` (§6.5).
    const overview = await getJobOrderOverview(orgId, jobOrder.id);
    expect(overview.steps[0]!.status).toBe('completed');
  });

  it('refuses by-products worth more than the whole operation', async () => {
    const stitching = await createNewProcess(orgId, {
      name: `Stitching ${unique()}`,
      itemChanges: true,
    });

    await stockUp(shirtId, 100, 500);
    const jobOrder = await createNewJobOrder(orgId, {
      steps: [
        {
          processId: stitching.id,
          processorId: cutterId,
          inputs: [{ itemId: shirtId, plannedQty: 100 }],
          outputs: [{ itemId: shirtsId, isPrimary: true }, { itemId: rejectsId }],
        },
      ],
    });
    const step = jobOrder.steps[0]!;

    const panelBatch = await runAsTenant(orgId, (tx) =>
      tx.batch.findFirstOrThrow({
        where: { organizationId: orgId, itemId: shirtId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
    );
    const issue = await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      lines: [{ itemId: shirtId, batchId: panelBatch.id, qty: 100 }],
    });

    // The operation is worth 500. Handing the by-product 900 would leave the
    // primary carrying a negative cost — which is not a rounding problem, it is
    // somebody having mistyped what the offcuts are worth.
    await expect(
      createNewJobReceipt(orgId, {
        jobOrderStepId: step.id,
        issueIds: [issue.id],
        locationId: godownId,
        lines: [{ itemId: shirtId, issuedQty: 100, receivedQty: 0 }],
        outputs: [
          { itemId: shirtsId, isPrimary: true, receivedQty: 90, acceptedQty: 90 },
          { itemId: rejectsId, receivedQty: 10, acceptedQty: 10, valueShare: 900 },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a bulk receipt that does not say which item it accounts for', async () => {
    const stitching = await createNewProcess(orgId, {
      name: `Stitching ${unique()}`,
      itemChanges: true,
    });

    await stockUp(threadId, 20);

    await stockUp(shirtId, 100);
    const jobOrder = await createNewJobOrder(orgId, {
      steps: [
        {
          processId: stitching.id,
          processorId: cutterId,
          inputs: [
            { itemId: shirtId, plannedQty: 100 },
            { itemId: threadId, plannedQty: 5 },
          ],
          outputs: [{ itemId: shirtsId, isPrimary: true }],
        },
      ],
    });
    const step = jobOrder.steps[0]!;

    const batchOf = async (itemId: string) =>
      runAsTenant(orgId, (tx) =>
        tx.batch.findFirstOrThrow({
          where: { organizationId: orgId, itemId, isDeleted: false },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        }),
      );

    const issue = await createNewJobIssue(orgId, {
      jobOrderStepId: step.id,
      sourceLocationId: godownId,
      lines: [
        { itemId: shirtId, batchId: (await batchOf(shirtId)).id, qty: 100 },
        { itemId: threadId, batchId: (await batchOf(threadId)).id, qty: 5 },
      ],
    });

    // Unnamed, the oldest open line is consumed first whatever item it is — so
    // this receipt would quietly eat 100 of the panels OR the thread depending
    // on insertion order. Refused rather than guessed.
    await expect(
      createNewJobReceipt(orgId, {
        jobOrderStepId: step.id,
        issueIds: [issue.id],
        locationId: godownId,
        lines: [{ issuedQty: 100, receivedQty: 90, acceptedQty: 90 }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses to issue a step until the step above it has delivered', async () => {
    const cutting = await createNewProcess(orgId, {
      name: `Cutting ${unique()}`,
      itemChanges: true,
    });
    const stitching = await createNewProcess(orgId, {
      name: `Stitching ${unique()}`,
      itemChanges: true,
    });

    await stockUp(dyedId, 100);

    const jobOrder = await createNewJobOrder(orgId, {
      steps: [
        {
          processId: cutting.id,
          processorId: cutterId,
          inputs: [{ itemId: dyedId, plannedQty: 100 }],
          outputs: [{ itemId: shirtId, isPrimary: true }],
        },
        {
          processId: stitching.id,
          processorId: cutterId,
          // Fed by step 1 — `classifyStepInputs` marks it fromStock: false, and
          // 60 is within the 100 panels cutting expects to return.
          inputs: [{ itemId: shirtId, plannedQty: 60 }],
          outputs: [{ itemId: shirtsId, isPrimary: true }],
        },
      ],
    });
    expect(jobOrder.steps[1]!.inputs[0]!.fromStock).toBe(false);

    /**
     * 🔴 Nothing has come back from cutting, so there is nothing for stitching
     * to send — and the no-stock scaffold must NOT invent it. Raw material can
     * be conjured while Purchase Received is missing; work in progress cannot,
     * because a step that produced nothing produced nothing.
     *
     * 🔴 Blocked BY POSITION, not by matching items. Asking whether step 2's
     * inputs were declared as fed by step 1 let a step whose PRODUCES list was
     * empty — or which named a different item — declare no link at all, and the
     * rule then silently did not apply.
     */
    await expect(
      createNewJobIssue(orgId, {
        jobOrderStepId: jobOrder.steps[1]!.id,
        sourceLocationId: godownId,
        lines: [{ itemId: shirtId, qty: 60 }],
      }),
    ).rejects.toMatchObject({ status: 409 });

    // The Overview says the same thing, in words, instead of a dead button.
    const overview = await getJobOrderOverview(orgId, jobOrder.id);
    expect(overview.steps[1]!.canIssue).toBe(false);
    expect(overview.steps[1]!.blockedReason).toContain('Nothing has come back from step 1');
    // Step 1 draws on stock, so it is free to go.
    expect(overview.steps[0]!.canIssue).toBe(true);
  });

  it('refuses two primary outputs, and the same item listed twice', async () => {
    const stitching = await createNewProcess(orgId, {
      name: `Stitching ${unique()}`,
      itemChanges: true,
    });

    const order = (steps: Parameters<typeof createNewJobOrder>[1]['steps']) =>
      createNewJobOrder(orgId, { steps });

    await expect(
      order([
        {
          processId: stitching.id,
          // Two outputs absorbing the cost means the operation was paid for
          // twice; none means it lands nowhere (§9.2.1).
          outputs: [
            { itemId: shirtsId, isPrimary: true },
            { itemId: rejectsId, isPrimary: true },
          ],
        },
      ]),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      order([
        {
          processId: stitching.id,
          inputs: [{ itemId: threadId }, { itemId: threadId, plannedQty: 5 }],
        },
      ]),
    ).rejects.toMatchObject({ status: 400 });
  });

  /**
   * 🔴 APPENDING WORK TO AN ORDER THAT HAS ALREADY STARTED.
   *
   * The whole safety argument is that nothing existing is touched: `seq = max +
   * 1` renumbers nobody, and no row is rewritten — so the challans hanging off
   * the steps already there keep describing steps that still say what they said.
   * `updateJobOrderById` is the contrast: it hard-deletes, and `JobIssue.step` is
   * `onDelete: Cascade`, which is why its delete is scoped past the WORK FRONT
   * and never over the whole grid (§6.6).
   *
   * The other half is what is NOT checked. No step's status gates this — a step
   * at a processor is no reason to withhold it, because the appended step arrives
   * `pending` and `chainNotReady` already refuses to let it issue until the step
   * above has delivered. Only the ORDER refuses, and only when it is closed.
   */
  describe('appending steps to a running order', () => {
    it('appends after the last step while it is still at the processor, and leaves its challan intact', async () => {
      const cutting = await createNewProcess(orgId, {
        name: `Cutting ${unique()}`,
        itemChanges: true,
      });
      const stitching = await createNewProcess(orgId, {
        name: `Stitching ${unique()}`,
        itemChanges: true,
      });

      // Dyed Fabric is batch-tracked, so the line has to name the batch it came
      // out of — `resolveLines` refuses a batch-less line for such an item.
      const dyedBatch = await stockUp(dyedId, 100);

      const jobOrder = await createNewJobOrder(orgId, {
        steps: [
          {
            processId: cutting.id,
            processorId: cutterId,
            inputs: [{ itemId: dyedId, plannedQty: 100 }],
            outputs: [{ itemId: shirtId, isPrimary: true, expectedQty: 90 }],
          },
        ],
      });
      const step1 = jobOrder.steps[0]!;

      // Material is out with the cutter — the state the old edit path refuses
      // outright, and the one this must handle.
      const issue = await createNewJobIssue(orgId, {
        jobOrderStepId: step1.id,
        sourceLocationId: godownId,
        lines: [{ itemId: dyedId, batchId: dyedBatch.id, qty: 100 }],
      });

      const after = await appendJobOrderSteps(orgId, jobOrder.id, {
        steps: [
          {
            processId: stitching.id,
            processorId: cutterId,
            inputs: [{ itemId: shirtId }],
            outputs: [{ itemId: shirtsId, isPrimary: true }],
          },
        ],
        reason: 'Party asked for stitching too',
      });

      expect(after.steps).toHaveLength(2);
      expect(after.steps.map((s) => s.seq)).toEqual([1, 2]);

      // 🔴 The step already issued against is the SAME ROW, untouched.
      expect(after.steps[0]!.id).toBe(step1.id);
      expect(after.steps[0]!.status).toBe('issued');

      // …and its challan still exists and still points at it. A cascade would
      // have taken this with it and left its ledger rows explaining nothing.
      const survivingIssue = await runAsTenant(orgId, (tx) =>
        tx.jobIssue.findFirst({ where: { id: issue.id }, select: { jobOrderStepId: true } }),
      );
      expect(survivingIssue?.jobOrderStepId).toBe(step1.id);

      /**
       * 🔴 The new step is classified AND planned against the steps ALREADY on the
       * order, not only against the ones in the request. Without that it reads as
       * drawn from stock, and it would have no ceiling to plan against — the one
       * door that skips the whole-grid rewrite would also skip the over-plan rule.
       */
      const appended = after.steps[1]!;
      expect(appended.inputs[0]!.itemId).toBe(shirtId);
      expect(appended.inputs[0]!.fromStock).toBe(false);
      // Planned from what step 1 expects to produce, seeded across the boundary.
      expect(Number(appended.inputs[0]!.plannedQty)).toBe(90);

      // Work added to a released order is a decision somebody reviews later.
      expect(after.remarks).toContain('Added step 2');
      expect(after.remarks).toContain('Party asked for stitching too');

      // The chain sequences it without any status check on our side: cutting has
      // returned nothing, so stitching has nothing to send on.
      const overview = await getJobOrderOverview(orgId, jobOrder.id);
      expect(overview.steps[1]!.canIssue).toBe(false);
      expect(overview.steps[1]!.blockedReason).toContain('Nothing has come back from step 1');
    });

    it('refuses an order that has been closed short', async () => {
      const cutting = await createNewProcess(orgId, {
        name: `Cutting ${unique()}`,
        itemChanges: true,
      });
      const stitching = await createNewProcess(orgId, {
        name: `Stitching ${unique()}`,
        itemChanges: true,
      });

      const jobOrder = await createNewJobOrder(orgId, {
        steps: [
          {
            processId: cutting.id,
            processorId: cutterId,
            inputs: [{ itemId: dyedId, plannedQty: 10 }],
            outputs: [{ itemId: shirtId, isPrimary: true }],
          },
        ],
      });
      await shortCloseJobOrder(orgId, jobOrder.id, 'finished light');

      /**
       * 🔴 The one refusal. `short_closed` is sticky, so the order would keep
       * that label forever while `chainNotReady` waives the chain after a
       * short-closed step — a document that reads as finished and still takes
       * challans.
       */
      await expect(
        appendJobOrderSteps(orgId, jobOrder.id, {
          steps: [
            {
              processId: stitching.id,
              inputs: [{ itemId: shirtId }],
              outputs: [{ itemId: shirtsId, isPrimary: true }],
            },
          ],
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  /**
   * 🔴 EDITING A RUNNING ORDER, UP TO THE WORK FRONT (§6.6).
   *
   * The lock used to be the whole order: one issue froze every step, and fixing
   * step 3 meant short-closing and starting again. It is now the last step
   * carrying a live document — behind it nothing may move, past it the grid is
   * rewritten exactly as a draft would be.
   *
   * The hazard these tests exist for is specific and silent: `updateJobOrderById`
   * hard-deletes, and `JobIssue.step` / `JobReceipt.step` are `onDelete: Cascade`.
   * A delete that is not scoped past the front takes every challan and receipt
   * with it and orphans their ledger rows, with nothing to show it happened.
   */
  describe('editing a running order', () => {
    const twoStepOrder = async () => {
      const cutting = await createNewProcess(orgId, {
        name: `Cutting ${unique()}`,
        itemChanges: true,
      });
      const stitching = await createNewProcess(orgId, {
        name: `Stitching ${unique()}`,
        itemChanges: true,
      });
      // Batch-tracked, so the line names its batch — see the note above.
      const dyedBatch = await stockUp(dyedId, 100);

      const jobOrder = await createNewJobOrder(orgId, {
        steps: [
          {
            processId: cutting.id,
            processorId: cutterId,
            inputs: [{ itemId: dyedId, plannedQty: 100 }],
            outputs: [{ itemId: shirtId, isPrimary: true, expectedQty: 90 }],
          },
          {
            processId: stitching.id,
            processorId: cutterId,
            inputs: [{ itemId: shirtId, plannedQty: 90 }],
            outputs: [{ itemId: shirtsId, isPrimary: true }],
          },
        ],
      });

      // Step 1 goes out. From here it is the work front and must not move.
      const issue = await createNewJobIssue(orgId, {
        jobOrderStepId: jobOrder.steps[0]!.id,
        sourceLocationId: godownId,
        lines: [{ itemId: dyedId, batchId: dyedBatch.id, qty: 100 }],
      });

      return { jobOrder, issue, cutting, stitching };
    };

    /** The payload as the form sends it: saved steps carry their ids. */
    const asSent = (step: { id: string; processId: string; processorId: string | null }) => ({
      id: step.id,
      processId: step.processId,
      processorId: step.processorId,
    });

    it('rewrites the steps past the work front and leaves the issued step and its challan alone', async () => {
      const { jobOrder, issue, stitching } = await twoStepOrder();
      const [cut, stitch] = jobOrder.steps;

      const after = await updateJobOrderById(orgId, jobOrder.id, {
        steps: [
          asSent(cut!),
          // Step 2 rewritten in place — different processor, different plan.
          {
            id: stitch!.id,
            processId: stitching.id,
            processorId: null,
            inputs: [{ itemId: shirtId, plannedQty: 50 }],
            outputs: [{ itemId: shirtsId, isPrimary: true }],
          },
          // …and a third step added in the same save.
          {
            processId: stitching.id,
            processorId: cutterId,
            inputs: [{ itemId: shirtsId }],
            outputs: [{ itemId: offcutsId, isPrimary: true }],
          },
        ],
      });

      expect(after.steps).toHaveLength(3);
      expect(after.steps.map((s) => s.seq)).toEqual([1, 2, 3]);

      // 🔴 The issued step is the SAME ROW, untouched.
      expect(after.steps[0]!.id).toBe(cut!.id);
      expect(after.steps[0]!.status).toBe('issued');

      // 🔴 …and its challan still exists and still points at it. A cascade would
      // have taken this and orphaned its ledger rows.
      const survivingIssue = await runAsTenant(orgId, (tx) =>
        tx.jobIssue.findFirst({ where: { id: issue.id }, select: { jobOrderStepId: true } }),
      );
      expect(survivingIssue?.jobOrderStepId).toBe(cut!.id);

      // Step 2 had no documents, so it was genuinely rewritten — new row, new plan.
      expect(after.steps[1]!.id).not.toBe(stitch!.id);
      expect(Number(after.steps[1]!.inputs[0]!.plannedQty)).toBe(50);
      expect(after.steps[1]!.processorId).toBeNull();
    });

    it('refuses to drop or reorder a step that has already been sent out', async () => {
      const { jobOrder, stitching } = await twoStepOrder();
      const [cut, stitch] = jobOrder.steps;

      // Step 1 left out entirely — the save that would have cascaded its challan.
      await expect(
        updateJobOrderById(orgId, jobOrder.id, { steps: [asSent(stitch!)] }),
      ).rejects.toMatchObject({ status: 409 });

      // Step 1 pushed below step 2 — same hazard, since seq is on the challan.
      await expect(
        updateJobOrderById(orgId, jobOrder.id, {
          steps: [asSent(stitch!), asSent(cut!)],
        }),
      ).rejects.toMatchObject({ status: 409 });

      // A stale form with no ids at all cannot prove it is the same grid.
      await expect(
        updateJobOrderById(orgId, jobOrder.id, {
          steps: [
            { processId: stitching.id, processorId: cutterId },
            { processId: stitching.id, processorId: cutterId },
          ],
        }),
      ).rejects.toMatchObject({ status: 409 });

      // Nothing was written by any of the three.
      const untouched = await getJobOrderById(orgId, jobOrder.id);
      expect(untouched!.steps.map((s) => s.id)).toEqual([cut!.id, stitch!.id]);
    });

    /**
     * A draft has no work front, so the whole grid is the tail and the behaviour
     * is exactly what it always was — including the header, which follows step 1.
     */
    it('still rewrites a draft end to end, header included', async () => {
      const cutting = await createNewProcess(orgId, {
        name: `Cutting ${unique()}`,
        itemChanges: true,
      });

      const jobOrder = await createNewJobOrder(orgId, {
        steps: [
          {
            processId: cutting.id,
            processorId: cutterId,
            inputs: [{ itemId: dyedId, plannedQty: 10 }],
            outputs: [{ itemId: shirtId, isPrimary: true }],
          },
        ],
      });
      expect(jobOrder.status).toBe('draft');

      const after = await updateJobOrderById(orgId, jobOrder.id, {
        steps: [
          {
            processId: cutting.id,
            processorId: cutterId,
            inputs: [{ itemId: threadId, plannedQty: 7 }],
            outputs: [{ itemId: shirtId, isPrimary: true }],
          },
        ],
      });

      expect(after.steps).toHaveLength(1);
      expect(after.steps[0]!.inputs[0]!.itemId).toBe(threadId);
      // CALC+ — derived from step 1's first consumed row, which just changed.
      expect(after.inputItemId).toBe(threadId);
      expect(Number(after.inputQty)).toBe(7);
    });

    it('refuses an order that has been closed short', async () => {
      const { jobOrder } = await twoStepOrder();
      await shortCloseJobOrder(orgId, jobOrder.id, 'finished light');

      await expect(
        updateJobOrderById(orgId, jobOrder.id, {
          steps: jobOrder.steps.map((step) => asSent(step)),
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });
});
