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
import {
  createNewJobOrder,
  getJobOrderOverview,
  manuallyCompleteStep,
} from '../job-orders/jobOrders.service.ts';
import { createNewJobIssue } from '../issues/jobIssues.service.ts';
import {
  cancelJobReceipt,
  createNewJobReceipt,
  getJobReceiptById,
  getReceivePrefill,
  postJobReceiptDraft,
} from './jobReceipts.service.ts';

/**
 * 🔴 Closing a challan on Receive (docs/JOBWORK_CHALLAN_CLOSURE_PLAN.md §8, tests
 * 21–30): everything still out on a closed challan is consumed into the goods'
 * cost, so completion finds nothing to write off.
 *
 * Every row is created by this file and hard-deleted afterwards (CLAUDE.md).
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let metreId: string;
let pieceId: string;
let godownId: string;
let dyerId: string;
let customerId: string;
let processId: string;

async function makeItem(
  name: string,
  opts: { composite?: boolean; pieces?: boolean; untracked?: boolean } = {},
) {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name,
        sku: `CC-${name}-${unique()}`,
        unit: opts.pieces ? 'Piece' : 'Metre',
        stockingUomId: opts.pieces ? pieceId : metreId,
        itemStructure: opts.composite ? 'composite' : 'single',
        inventoryTracking: opts.untracked ? 'none' : 'batch',
        trackInventory: true,
      },
      select: { id: true },
    });
    return item.id;
  });
}

const recipe = (compositeId: string, components: [string, number][]) =>
  runAsTenant(orgId, (tx) =>
    tx.compositeItemComponent.createMany({
      data: components.map(([componentItemId, qtyPerUnit], seq) => ({
        organizationId: orgId,
        compositeItemId: compositeId,
        componentItemId,
        qtyPerUnit,
        seq,
      })),
    }),
  );

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

type PlanRow = { itemId: string; plannedQty?: number; expectedQty?: number; rate?: number };

async function planStep(inputs: PlanRow[], outputs: PlanRow[], owner?: string) {
  const jo = await createNewJobOrder(orgId, {
    ownership: owner ? 'customer' : 'own',
    ownerPartyId: owner ?? null,
    steps: [{ processId, processorType: 'vendor', processorId: dyerId, inputs, outputs }],
  });
  return { jobOrderId: jo.id, stepId: jo.steps[0]!.id };
}

async function issue(stepId: string, lines: { itemId: string; batchId: string; qty: number }[]) {
  const challan = await createNewJobIssue(orgId, {
    jobOrderStepId: stepId,
    sourceLocationId: godownId,
    lines,
  });
  const row = await runAsTenant(orgId, (tx) =>
    tx.jobIssue.findFirstOrThrow({
      where: { id: challan.id, organizationId: orgId },
      select: { destinationLocationId: true, challanNumber: true },
    }),
  );
  return {
    id: challan.id,
    challanNumber: row.challanNumber,
    processorLocationId: row.destinationLocationId,
  };
}

type Returned = { itemId: string; accepted: number };

const receive = (
  stepId: string,
  issueIds: string[],
  inputItemIds: string[],
  returned: Returned[],
  opts: { closed?: string[]; typed?: Record<string, number>; mode?: 'post' | 'draft' } = {},
) =>
  createNewJobReceipt(
    orgId,
    {
      jobOrderStepId: stepId,
      issueIds,
      closedIssueIds: opts.closed ?? [],
      locationId: godownId,
      lines: inputItemIds.map((itemId) => ({
        itemId,
        issuedQty: opts.typed?.[itemId],
        receivedQty: 0,
      })),
      outputs: returned.map((row, index) => ({
        itemId: row.itemId,
        isPrimary: index === 0,
        receivedQty: row.accepted,
        acceptedQty: row.accepted,
        reworkQty: 0,
        batchReference: `OUT-${unique()}`,
      })),
    },
    undefined,
    opts.mode ?? 'post',
  );

const qtyAt = async (batchId: string, locationId: string) =>
  (
    await runAsTenant(orgId, (tx) => getBalance(tx, { organizationId: orgId, batchId, locationId }))
  ).qty.toString();

const valueOf = async (batchId: string) =>
  (await runAsTenant(orgId, (tx) => getBalance(tx, { organizationId: orgId, batchId }))).value;

const writeOffRows = (stepId: string) =>
  runAsTenant(orgId, (tx) =>
    tx.stockLedgerEntry.findMany({
      where: {
        organizationId: orgId,
        sourceDocType: SOURCE_DOC_TYPES.jobOrderStep,
        sourceDocId: stepId,
      },
      select: { qtyOut: true },
    }),
  );

/** Outstanding per challan, as the Receive screen sees it. */
async function stillOut(stepId: string) {
  const prefill = await getReceivePrefill(orgId, stepId);
  const byChallan = new Map<string, number>();
  for (const line of prefill.lines) {
    byChallan.set(line.jobIssueId, (byChallan.get(line.jobIssueId) ?? 0) + Number(line.issuedQty));
  }
  return { byChallan, closed: prefill.closedIssues };
}

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `challan-closure-${unique()}`, orgCode: uniqueOrgCode() },
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
    pieceId = (
      await tx.unitOfMeasurement.create({
        data: { organizationId: orgId, unitName: 'Piece', symbol: 'PCS' },
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
    await tx.compositeItemComponent.deleteMany({ where: { organizationId: orgId } });
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

/** Cotton ₹10/m, 1,000 m planned for 950 m expected, dyed at ₹12 per accepted metre. */
async function dyeingRun(owner?: string) {
  const cotton = await makeItem('Cotton');
  const dyed = await makeItem('Dyed');
  const batch = await seedStock(cotton, 1000, 10, owner);
  const { jobOrderId, stepId } = await planStep(
    [{ itemId: cotton, plannedQty: 1000 }],
    [{ itemId: dyed, expectedQty: 950, rate: 12 }],
    owner,
  );
  const challan = await issue(stepId, [{ itemId: cotton, batchId: batch.id, qty: 1000 }]);
  return { cotton, dyed, batch, jobOrderId, stepId, challan };
}

/** Example J: JC-1 500 m then JC-2 300 m, 800 planned for 760 expected, ₹12. */
async function twoChallans() {
  const cotton = await makeItem('Cotton');
  const dyed = await makeItem('Dyed');
  const batch = await seedStock(cotton, 800, 10);
  const { jobOrderId, stepId } = await planStep(
    [{ itemId: cotton, plannedQty: 800 }],
    [{ itemId: dyed, expectedQty: 760, rate: 12 }],
  );
  const jc1 = await issue(stepId, [{ itemId: cotton, batchId: batch.id, qty: 500 }]);
  const jc2 = await issue(stepId, [{ itemId: cotton, batchId: batch.id, qty: 300 }]);
  return { cotton, dyed, batch, jobOrderId, stepId, jc1, jc2 };
}

describe('closing a challan — cost', { timeout: 120_000 }, () => {
  it('21 (H): one closed receipt puts all ₹10,000 into 900 m, and completion writes off nothing', async () => {
    const run = await dyeingRun();
    const receipt = await receive(
      run.stepId,
      [run.challan.id],
      [run.cotton],
      [{ itemId: run.dyed, accepted: 900 }],
      { closed: [run.challan.id] },
    );

    expect(receipt.consumedValue.toString()).toBe('10000');
    expect(receipt.outputs[0]!.materialValue.toString()).toBe('10000');
    expect((await valueOf(receipt.outputBatchId!)).dividedBy(900).toFixed(4)).toBe('23.1111');
    expect(receipt.lines.every((line) => line.closesChallan)).toBe(true);
    expect(await qtyAt(run.batch.id, run.challan.processorLocationId)).toBe('0');

    await manuallyCompleteStep(orgId, run.jobOrderId, run.stepId, undefined);
    expect(await writeOffRows(run.stepId)).toHaveLength(0);
    expect(await qtyAt(run.batch.id, run.challan.processorLocationId)).toBe('0');
  });

  it('22 (I): two receipts at ₹22.5263 and ₹23.8421 blend to ₹23.1111, with no loss', async () => {
    const run = await dyeingRun();
    const first = await receive(
      run.stepId,
      [run.challan.id],
      [run.cotton],
      [{ itemId: run.dyed, accepted: 500 }],
    );
    const second = await receive(
      run.stepId,
      [run.challan.id],
      [run.cotton],
      [{ itemId: run.dyed, accepted: 400 }],
      { closed: [run.challan.id] },
    );

    const firstValue = await valueOf(first.outputBatchId!);
    const secondValue = await valueOf(second.outputBatchId!);
    expect(firstValue.dividedBy(500).toFixed(4)).toBe('22.5263');
    expect(second.outputs[0]!.materialValue.toString()).toBe('4736.842');
    expect(secondValue.dividedBy(400).toFixed(4)).toBe('23.8421');
    expect(firstValue.plus(secondValue).dividedBy(900).toFixed(4)).toBe('23.1111');

    await manuallyCompleteStep(orgId, run.jobOrderId, run.stepId, undefined);
    expect(await writeOffRows(run.stepId)).toHaveLength(0);
  });

  it('23 (J): closing the NEWER challan empties that one, not the older one', async () => {
    const run = await twoChallans();
    const receipt = await receive(
      run.stepId,
      [run.jc1.id, run.jc2.id],
      [run.cotton],
      [{ itemId: run.dyed, accepted: 250 }],
      { closed: [run.jc2.id] },
    );

    expect(receipt.consumedValue.toString()).toBe('3000');
    expect((await valueOf(receipt.outputBatchId!)).dividedBy(250).toFixed(2)).toBe('24.00');
    const consumed = receipt.lines.filter((line) => Number(line.issuedQty) > 0);
    expect(consumed.map((line) => line.jobIssueId)).toEqual([run.jc2.id]);

    const out = await stillOut(run.stepId);
    expect(out.byChallan.get(run.jc1.id)).toBe(500);
    expect(out.byChallan.has(run.jc2.id)).toBe(false);
    expect(out.closed).toEqual([
      expect.objectContaining({ id: run.jc2.id, closedByReceiptNumber: receipt.receiptNumber }),
    ]);

    const overview = await getJobOrderOverview(orgId, run.jobOrderId);
    const input = overview.steps[0]!.itemTotals.inputs[0]!;
    expect(input.closedQty).toBe('300');
    expect(input.stillOutQty).toBe('500');
  });

  it('26 (R11): a typed Used below the floor is refused naming both; above it, it wins', async () => {
    const run = await twoChallans();
    const refusal = receive(
      run.stepId,
      [run.jc1.id, run.jc2.id],
      [run.cotton],
      [{ itemId: run.dyed, accepted: 250 }],
      { closed: [run.jc2.id], typed: { [run.cotton]: 280 } },
    );
    await expect(refusal).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/280[\s\S]*300/),
      details: { 'lines.0': expect.any(String) },
    });

    const receipt = await receive(
      run.stepId,
      [run.jc1.id, run.jc2.id],
      [run.cotton],
      [{ itemId: run.dyed, accepted: 250 }],
      { closed: [run.jc2.id], typed: { [run.cotton]: 320 } },
    );
    expect(receipt.consumedValue.toString()).toBe('3200');
    const out = await stillOut(run.stepId);
    expect(out.byChallan.get(run.jc1.id)).toBe(480);
    expect(out.byChallan.has(run.jc2.id)).toBe(false);
  });

  it('29 (R7): conservation holds to the paisa on a closed receipt split across two outputs', async () => {
    const cotton = await makeItem('Cotton');
    const red = await makeItem('Red', { composite: true });
    const green = await makeItem('Green', { composite: true });
    await recipe(red, [[cotton, 1]]);
    await recipe(green, [[cotton, 1]]);
    const batch = await seedStock(cotton, 1000, 10.37);
    const { stepId } = await planStep(
      [{ itemId: cotton, plannedQty: 1000 }],
      [
        { itemId: red, expectedQty: 500, rate: 3 },
        { itemId: green, expectedQty: 450, rate: 4 },
      ],
    );
    const challan = await issue(stepId, [{ itemId: cotton, batchId: batch.id, qty: 1000 }]);

    const receipt = await receive(
      stepId,
      [challan.id],
      [cotton],
      [
        { itemId: red, accepted: 413 },
        { itemId: green, accepted: 391 },
      ],
      { closed: [challan.id] },
    );
    const materialSum = receipt.outputs.reduce(
      (sum, row) => sum.plus(row.materialValue),
      receipt.consumedValue.minus(receipt.consumedValue),
    );
    expect(receipt.consumedValue.toString()).toBe('10370');
    expect(materialSum.toString()).toBe(receipt.consumedValue.toString());
    expect(await qtyAt(batch.id, challan.processorLocationId)).toBe('0');
  });

  it('30: customer-owned — closing posts every value at 0 and still empties the challan', async () => {
    const run = await dyeingRun(customerId);
    const receipt = await receive(
      run.stepId,
      [run.challan.id],
      [run.cotton],
      [{ itemId: run.dyed, accepted: 900 }],
      { closed: [run.challan.id] },
    );
    expect(receipt.consumedValue.toString()).toBe('0');
    expect(receipt.outputs[0]!.materialValue.toString()).toBe('0');
    expect(await qtyAt(run.batch.id, run.challan.processorLocationId)).toBe('0');
  });
});

describe('closing a challan — reopening and refusals', { timeout: 120_000 }, () => {
  it('24 (K) + 27 (R14): refused while the closing receipt stands; cancelling it reopens', async () => {
    const run = await twoChallans();
    const closing = await receive(
      run.stepId,
      [run.jc1.id, run.jc2.id],
      [run.cotton],
      [{ itemId: run.dyed, accepted: 250 }],
      { closed: [run.jc2.id] },
    );

    await expect(
      receive(run.stepId, [run.jc2.id], [run.cotton], [{ itemId: run.dyed, accepted: 10 }]),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(closing.receiptNumber),
    });
    // A draft cannot park against it either.
    await expect(
      receive(run.stepId, [run.jc2.id], [run.cotton], [{ itemId: run.dyed, accepted: 10 }], {
        mode: 'draft',
      }),
    ).rejects.toMatchObject({ status: 409 });
    // The open challan beside it is unaffected.
    await receive(run.stepId, [run.jc1.id], [run.cotton], [{ itemId: run.dyed, accepted: 100 }]);

    await cancelJobReceipt(orgId, closing.id, 'wrong challan closed');
    const out = await stillOut(run.stepId);
    expect(out.byChallan.get(run.jc2.id)).toBe(300);
    expect(out.closed).toEqual([]);

    const fresh = await receive(
      run.stepId,
      [run.jc2.id],
      [run.cotton],
      [{ itemId: run.dyed, accepted: 200 }],
    );
    expect(Number(fresh.lines[0]!.issuedQty)).toBeGreaterThan(0);
    expect(fresh.lines[0]!.jobIssueId).toBe(run.jc2.id);
  });

  it('25 (L, R13): refuses closing a challan whose item nothing received is made from', async () => {
    const cotton = await makeItem('Cotton');
    const buttons = await makeItem('Buttons', { pieces: true });
    const redCotton = await makeItem('Red Cotton', { composite: true });
    await recipe(redCotton, [[cotton, 1]]);
    const cottonBatch = await seedStock(cotton, 100, 10);
    const buttonBatch = await seedStock(buttons, 50, 1);
    const { stepId } = await planStep(
      [
        { itemId: cotton, plannedQty: 100 },
        { itemId: buttons, plannedQty: 50 },
      ],
      [{ itemId: redCotton, expectedQty: 95, rate: 5 }],
    );
    const fabricChallan = await issue(stepId, [
      { itemId: cotton, batchId: cottonBatch.id, qty: 100 },
    ]);
    const buttonChallan = await issue(stepId, [
      { itemId: buttons, batchId: buttonBatch.id, qty: 50 },
    ]);

    await expect(
      receive(
        stepId,
        [fabricChallan.id, buttonChallan.id],
        [cotton, buttons],
        [{ itemId: redCotton, accepted: 50 }],
        { closed: [buttonChallan.id] },
      ),
    ).rejects.toMatchObject({
      status: 400,
      details: { closedIssueIds: expect.stringContaining(buttonChallan.challanNumber) },
    });
  });

  it('refuses closing a challan the receipt is not received against', async () => {
    const run = await twoChallans();
    await expect(
      receive(run.stepId, [run.jc1.id], [run.cotton], [{ itemId: run.dyed, accepted: 100 }], {
        closed: [run.jc2.id],
      }),
    ).rejects.toMatchObject({ status: 400, details: { closedIssueIds: expect.any(String) } });
  });

  it('without a closure, allocation stays oldest first exactly as before', async () => {
    const run = await twoChallans();
    const receipt = await receive(
      run.stepId,
      [run.jc1.id, run.jc2.id],
      [run.cotton],
      [{ itemId: run.dyed, accepted: 250 }],
    );
    const consumed = receipt.lines.filter((line) => Number(line.issuedQty) > 0);
    expect(consumed.map((line) => line.jobIssueId)).toEqual([run.jc1.id]);
    expect(receipt.lines.some((line) => line.closesChallan)).toBe(false);
  });
});

describe('closing a challan — drafts', { timeout: 120_000 }, () => {
  it('28: a draft remembers its closures across save and reload, and posts with them', async () => {
    const cotton = await makeItem('Cotton');
    const loose = await makeItem('Loose Dyed', { untracked: true });
    const batch = await seedStock(cotton, 800, 10);
    const { stepId } = await planStep(
      [{ itemId: cotton, plannedQty: 800 }],
      [{ itemId: loose, expectedQty: 760, rate: 12 }],
    );
    const jc1 = await issue(stepId, [{ itemId: cotton, batchId: batch.id, qty: 500 }]);
    const jc2 = await issue(stepId, [{ itemId: cotton, batchId: batch.id, qty: 300 }]);

    const draft = await receive(
      stepId,
      [jc1.id, jc2.id],
      [cotton],
      [{ itemId: loose, accepted: 250 }],
      { closed: [jc2.id], mode: 'draft' },
    );
    expect(draft.status).toBe('draft');
    // Nothing is closed by a draft: the challan is still fully out and receivable.
    expect((await stillOut(stepId)).byChallan.get(jc2.id)).toBe(300);

    const reloaded = await getJobReceiptById(orgId, draft.id);
    const closedOnDraft = new Set(
      reloaded!.lines.filter((line) => line.closesChallan).map((line) => line.jobIssueId),
    );
    expect([...closedOnDraft]).toEqual([jc2.id]);

    const posted = await postJobReceiptDraft(orgId, draft.id);
    expect(posted.status).toBe('posted');
    expect(posted.consumedValue.toString()).toBe('3000');
    const out = await stillOut(stepId);
    expect(out.byChallan.get(jc1.id)).toBe(500);
    expect(out.byChallan.has(jc2.id)).toBe(false);
  });

  it('28: a draft that typed its use on the challan lines still empties the closed challan', async () => {
    const cotton = await makeItem('Cotton');
    const loose = await makeItem('Loose Dyed', { untracked: true });
    const batch = await seedStock(cotton, 800, 10);
    const { stepId } = await planStep(
      [{ itemId: cotton, plannedQty: 800 }],
      [{ itemId: loose, expectedQty: 760, rate: 12 }],
    );
    const jc1 = await issue(stepId, [{ itemId: cotton, batchId: batch.id, qty: 500 }]);
    const jc2 = await issue(stepId, [{ itemId: cotton, batchId: batch.id, qty: 300 }]);

    const draft = await receive(
      stepId,
      [jc1.id, jc2.id],
      [cotton],
      [{ itemId: loose, accepted: 250 }],
      { closed: [jc2.id], typed: { [cotton]: 320 }, mode: 'draft' },
    );
    // Another receipt takes 50 m off JC-2 before the draft is posted.
    await receive(stepId, [jc2.id], [cotton], [{ itemId: loose, accepted: 40 }], {
      typed: { [cotton]: 50 },
    });

    const posted = await postJobReceiptDraft(orgId, draft.id);
    expect(posted.consumedValue.toString()).toBe('3200');
    const out = await stillOut(stepId);
    expect(out.byChallan.get(jc1.id)).toBe(430);
    expect(out.byChallan.has(jc2.id)).toBe(false);
  });
});
