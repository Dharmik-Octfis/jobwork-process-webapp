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
import { createNewJobOrder, manuallyCompleteStep } from '../job-orders/jobOrders.service.ts';
import { createNewJobIssue } from '../issues/jobIssues.service.ts';
import {
  cancelJobReceipt,
  createNewJobReceipt,
  getReceivePrefill,
  postJobReceiptDraft,
} from './jobReceipts.service.ts';

/**
 * 🔴 The landed-cost engine on real postings (docs/JOBWORK_LANDED_COST_PLAN.md §8
 * tests 3–17). The arithmetic alone is in `landedCost.test.ts`; this file checks that
 * the receipt consumes exactly what it should, stores the breakdown, and refuses
 * what it must.
 *
 * Every row is created by this file and hard-deleted afterwards (CLAUDE.md).
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let metreId: string;
let pieceId: string;
let godownId: string;
let dyerId: string;
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
        sku: `LC-${name}-${unique()}`,
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

async function seedStock(itemId: string, qty: number, valuePerUnit: number) {
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
      valueIn: qty * valuePerUnit,
      sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
      sourceDocId: batch.id,
    });
    return batch;
  });
}

type PlanRow = { itemId: string; plannedQty?: number; expectedQty?: number; rate?: number };

async function planStep(inputs: PlanRow[], outputs: PlanRow[]) {
  const jo = await createNewJobOrder(orgId, {
    steps: [{ processId, processorType: 'vendor', processorId: dyerId, inputs, outputs }],
  });
  return { jobOrderId: jo.id, stepId: jo.steps[0]!.id };
}

async function issue(
  stepId: string,
  lines: { itemId: string; batchId: string; qty: number }[],
  isRework = false,
) {
  const challan = await createNewJobIssue(orgId, {
    jobOrderStepId: stepId,
    sourceLocationId: godownId,
    lines,
    isRework,
  });
  const { destinationLocationId } = await runAsTenant(orgId, (tx) =>
    tx.jobIssue.findFirstOrThrow({
      where: { id: challan.id, organizationId: orgId },
      select: { destinationLocationId: true },
    }),
  );
  return { id: challan.id, processorLocationId: destinationLocationId };
}

type Returned = { itemId: string; accepted: number; rework?: number; rate?: number };

/** A receipt whose Used figures are calculated unless `typed` names one. */
const receive = (
  stepId: string,
  issueIds: string[],
  inputItemIds: string[],
  returned: Returned[],
  typed: Record<string, number> = {},
  mode: 'post' | 'draft' = 'post',
) =>
  createNewJobReceipt(
    orgId,
    {
      jobOrderStepId: stepId,
      issueIds,
      locationId: godownId,
      lines: inputItemIds.map((itemId) => ({
        itemId,
        issuedQty: typed[itemId],
        receivedQty: 0,
      })),
      outputs: returned.map((row, index) => ({
        itemId: row.itemId,
        isPrimary: index === 0,
        receivedQty: row.accepted + (row.rework ?? 0),
        acceptedQty: row.accepted,
        reworkQty: row.rework ?? 0,
        batchReference: `OUT-${unique()}`,
        reworkBatchReference: row.rework ? `RW-${unique()}` : undefined,
        rate: row.rate,
      })),
    },
    undefined,
    mode,
  );

const qtyAt = async (batchId: string, locationId: string) =>
  (
    await runAsTenant(orgId, (tx) => getBalance(tx, { organizationId: orgId, batchId, locationId }))
  ).qty.toString();

const valueOf = async (batchId: string) =>
  (await runAsTenant(orgId, (tx) => getBalance(tx, { organizationId: orgId, batchId }))).value;

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `landed-cost-${unique()}`, orgCode: uniqueOrgCode() },
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
    await tx.unitOfMeasurement.deleteMany({ where: { organizationId: orgId } });
    await tx.numberSequence.deleteMany({ where: { organizationId: orgId } });
  });
  await deleteTestOrganization(orgId);
});

/** Cotton ₹10/m, 1,000 m planned for 950 m expected, dyed at ₹12 per accepted metre. */
async function dyeingRun() {
  const cotton = await makeItem('Cotton');
  const dyed = await makeItem('Dyed');
  const batch = await seedStock(cotton, 1000, 10);
  const { jobOrderId, stepId } = await planStep(
    [{ itemId: cotton, plannedQty: 1000 }],
    [{ itemId: dyed, expectedQty: 950, rate: 12 }],
  );
  const challan = await issue(stepId, [{ itemId: cotton, batchId: batch.id, qty: 1000 }]);
  return { cotton, dyed, batch, jobOrderId, stepId, challan };
}

describe('receipt — landed cost on real postings', { timeout: 120_000 }, () => {
  it('prefills what the cost preview needs: unit cost at the processor, rate and recipe', async () => {
    const run = await dyeingRun();
    const prefill = await getReceivePrefill(orgId, run.stepId);
    expect(prefill.lines).toHaveLength(1);
    expect(prefill.lines[0]!.unitCost).toBe('10');
    expect(prefill.outputs[0]!.rate).toBe('12');

    const cotton = await makeItem('Cotton');
    const redCotton = await makeItem('Red Cotton', { composite: true });
    await recipe(redCotton, [[cotton, 1]]);
    const { stepId } = await planStep(
      [{ itemId: cotton, plannedQty: 100 }],
      [{ itemId: redCotton, expectedQty: 95, rate: 5 }],
    );
    const composite = await getReceivePrefill(orgId, stepId);
    expect(composite.step.outputs[0]!.components.map((row) => row.componentItemId)).toEqual([
      cotton,
    ]);
  });

  it('A: consumes by the plan ratio and stores the breakdown on both partial receipts', async () => {
    const run = await dyeingRun();

    const first = await receive(
      run.stepId,
      [run.challan.id],
      [run.cotton],
      [{ itemId: run.dyed, accepted: 500 }],
    );
    expect(first.outputs[0]!.materialValue.toString()).toBe('5263.158');
    expect(first.outputs[0]!.processCharge.toString()).toBe('6000');
    expect(first.outputs[0]!.rate?.toString()).toBe('12');
    expect(first.consumedValue.toString()).toBe('5263.158');
    expect(first.processChargeTotal.toString()).toBe('6000');
    expect((await valueOf(first.outputBatchId!)).toString()).toBe('11263.158');

    const second = await receive(
      run.stepId,
      [run.challan.id],
      [run.cotton],
      [{ itemId: run.dyed, accepted: 450 }],
    );
    expect(second.outputs[0]!.materialValue.toString()).toBe('4736.842');
    expect(await qtyAt(run.batch.id, run.challan.processorLocationId)).toBe('0');
  });

  it('C: caps a calculated use at what is still outstanding', async () => {
    const run = await dyeingRun();
    await receive(
      run.stepId,
      [run.challan.id],
      [run.cotton],
      [{ itemId: run.dyed, accepted: 500 }],
    );

    const second = await receive(
      run.stepId,
      [run.challan.id],
      [run.cotton],
      [{ itemId: run.dyed, accepted: 460 }],
    );
    expect(second.outputs[0]!.materialValue.toString()).toBe('4736.842');
    expect(second.outputs[0]!.processCharge.toString()).toBe('5520');
    expect(await qtyAt(run.batch.id, run.challan.processorLocationId)).toBe('0');
  });

  it('G: a typed Used figure wins over the calculation', async () => {
    const run = await dyeingRun();

    const first = await receive(
      run.stepId,
      [run.challan.id],
      [run.cotton],
      [{ itemId: run.dyed, accepted: 500 }],
      { [run.cotton]: 540 },
    );
    expect(first.outputs[0]!.materialValue.toString()).toBe('5400');

    const second = await receive(
      run.stepId,
      [run.challan.id],
      [run.cotton],
      [{ itemId: run.dyed, accepted: 450 }],
    );
    expect(second.outputs[0]!.materialValue.toString()).toBe('4600');
  });

  it('D: several composites share the fabric by need, conserved to the paisa', async () => {
    const cotton = await makeItem('Cotton');
    const silk = await makeItem('Silk');
    const redCotton = await makeItem('Red Cotton', { composite: true });
    const redSilk = await makeItem('Red Silk', { composite: true });
    const greenCotton = await makeItem('Green Cotton', { composite: true });
    await recipe(redCotton, [[cotton, 1]]);
    await recipe(redSilk, [[silk, 1]]);
    await recipe(greenCotton, [[cotton, 1]]);
    const cottonBatch = await seedStock(cotton, 1000, 10);
    const silkBatch = await seedStock(silk, 1000, 20);

    const { stepId } = await planStep(
      [
        { itemId: cotton, plannedQty: 1000 },
        { itemId: silk, plannedQty: 1000 },
      ],
      [
        { itemId: redCotton, expectedQty: 712.5, rate: 12 },
        { itemId: redSilk, expectedQty: 950, rate: 12 },
        { itemId: greenCotton, expectedQty: 237.5, rate: 25 },
      ],
    );
    const challan = await issue(stepId, [
      { itemId: cotton, batchId: cottonBatch.id, qty: 1000 },
      { itemId: silk, batchId: silkBatch.id, qty: 1000 },
    ]);

    const receipt = await receive(
      stepId,
      [challan.id],
      [cotton, silk],
      [
        { itemId: redCotton, accepted: 300 },
        { itemId: redSilk, accepted: 200 },
        { itemId: greenCotton, accepted: 100 },
      ],
    );

    const byItem = new Map(receipt.outputs.map((row) => [row.itemId, row]));
    const total = (itemId: string) =>
      Number(byItem.get(itemId)!.materialValue.plus(byItem.get(itemId)!.processCharge));
    expect(total(redCotton)).toBeCloseTo(6757.89, 1);
    expect(total(redSilk)).toBeCloseTo(6610.53, 1);
    expect(total(greenCotton)).toBeCloseTo(3552.63, 1);

    const materialSum = receipt.outputs.reduce(
      (sum, row) => sum.plus(row.materialValue),
      receipt.consumedValue.minus(receipt.consumedValue),
    );
    expect(materialSum.toString()).toBe(receipt.consumedValue.toString());
  });

  it('E: a composite of a composite costs fabric and buttons by their own ratios', async () => {
    const cotton = await makeItem('Cotton');
    const redCotton = await makeItem('Red Cotton', { composite: true });
    const buttons = await makeItem('Buttons', { pieces: true });
    const shirt = await makeItem('Shirt', { composite: true, pieces: true });
    await recipe(redCotton, [[cotton, 1]]);
    await recipe(shirt, [
      [redCotton, 1.5],
      [buttons, 6],
    ]);
    const fabricBatch = await seedStock(redCotton, 150, 22.5263);
    const buttonBatch = await seedStock(buttons, 588, 1);

    const { stepId } = await planStep(
      [
        { itemId: redCotton, plannedQty: 150 },
        { itemId: buttons, plannedQty: 588 },
      ],
      [{ itemId: shirt, expectedQty: 98, rate: 40 }],
    );
    const challan = await issue(stepId, [
      { itemId: redCotton, batchId: fabricBatch.id, qty: 150 },
      { itemId: buttons, batchId: buttonBatch.id, qty: 588 },
    ]);

    const receipt = await receive(
      stepId,
      [challan.id],
      [redCotton, buttons],
      [{ itemId: shirt, accepted: 98 }],
    );
    const value = await valueOf(receipt.outputBatchId!);
    expect(value.dividedBy(98).toFixed(2)).toBe('80.48');
  });

  it('F: a unit change without a composite leaves 16.6667 m at the processor', async () => {
    const fabric = await makeItem('Fabric');
    const panels = await makeItem('Panels', { pieces: true });
    const batch = await seedStock(fabric, 1000, 10);
    const { stepId } = await planStep(
      [{ itemId: fabric, plannedQty: 1000 }],
      [{ itemId: panels, expectedQty: 1200, rate: 2 }],
    );
    const challan = await issue(stepId, [{ itemId: fabric, batchId: batch.id, qty: 1000 }]);

    await receive(stepId, [challan.id], [fabric], [{ itemId: panels, accepted: 600 }]);
    await receive(stepId, [challan.id], [fabric], [{ itemId: panels, accepted: 580 }]);
    expect(await qtyAt(batch.id, challan.processorLocationId)).toBe('16.6667');
  });
});

describe('receipt — rework', { timeout: 120_000 }, () => {
  it('charges a rework piece once, on the receipt that accepts it', async () => {
    const run = await dyeingRun();
    const first = await receive(
      run.stepId,
      [run.challan.id],
      [run.cotton],
      [{ itemId: run.dyed, accepted: 450, rework: 50 }],
    );
    expect(first.outputs[0]!.processCharge.toString()).toBe('5400');

    const reworkChallan = await issue(
      run.stepId,
      [{ itemId: run.dyed, batchId: first.reworkBatchId!, qty: 50 }],
      true,
    );
    const rework = await receive(
      run.stepId,
      [reworkChallan.id],
      [run.dyed],
      [{ itemId: run.dyed, accepted: 50 }],
    );
    expect(rework.outputs[0]!.materialValue.toString()).toBe('526.3158');
    expect(rework.outputs[0]!.processCharge.toString()).toBe('600');
  });

  it('refuses rework and first-pass challans on one receipt', async () => {
    const cotton = await makeItem('Cotton');
    const dyed = await makeItem('Dyed');
    const batch = await seedStock(cotton, 1100, 10);
    const { stepId } = await planStep(
      [{ itemId: cotton, plannedQty: 1100 }],
      [{ itemId: dyed, expectedQty: 1045, rate: 12 }],
    );
    const firstChallan = await issue(stepId, [{ itemId: cotton, batchId: batch.id, qty: 1000 }]);
    const first = await receive(
      stepId,
      [firstChallan.id],
      [cotton],
      [{ itemId: dyed, accepted: 450, rework: 50 }],
    );
    const reworkChallan = await issue(
      stepId,
      [{ itemId: dyed, batchId: first.reworkBatchId!, qty: 50 }],
      true,
    );
    const moreChallan = await issue(stepId, [{ itemId: cotton, batchId: batch.id, qty: 100 }]);

    await expect(
      receive(
        stepId,
        [reworkChallan.id, moreChallan.id],
        [cotton, dyed],
        [{ itemId: dyed, accepted: 50 }],
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('receipt — what the engine refuses', { timeout: 120_000 }, () => {
  it('refuses receipts and cancellations once the step is completed', async () => {
    const run = await dyeingRun();
    const first = await receive(
      run.stepId,
      [run.challan.id],
      [run.cotton],
      [{ itemId: run.dyed, accepted: 500 }],
    );
    await manuallyCompleteStep(orgId, run.jobOrderId, run.stepId, undefined);

    await expect(
      receive(run.stepId, [run.challan.id], [run.cotton], [{ itemId: run.dyed, accepted: 100 }]),
    ).rejects.toMatchObject({ status: 409 });
    await expect(cancelJobReceipt(orgId, first.id, 'too late')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('refuses a step whose composite output has no recipe frozen onto it', async () => {
    const cotton = await makeItem('Cotton');
    const silk = await makeItem('Silk');
    const mix = await makeItem('Mix', { composite: true });
    await recipe(mix, [
      [cotton, 1],
      [silk, 1],
    ]);
    const cottonBatch = await seedStock(cotton, 100, 10);
    const silkBatch = await seedStock(silk, 100, 20);
    const { stepId } = await planStep(
      [
        { itemId: cotton, plannedQty: 100 },
        { itemId: silk, plannedQty: 100 },
      ],
      [{ itemId: mix, expectedQty: 95, rate: 5 }],
    );
    const challan = await issue(stepId, [
      { itemId: cotton, batchId: cottonBatch.id, qty: 100 },
      { itemId: silk, batchId: silkBatch.id, qty: 100 },
    ]);
    // As a step planned before recipes were frozen onto job orders would be.
    await runAsTenant(orgId, (tx) =>
      tx.jobOrderStepOutputComponent.updateMany({
        where: { organizationId: orgId },
        data: { isDeleted: true },
      }),
    );

    await expect(
      receive(stepId, [challan.id], [cotton, silk], [{ itemId: mix, accepted: 50 }]),
    ).rejects.toMatchObject({ status: 409, details: { plan: expect.any(String) } });
  });

  it('refuses a returned item the step’s plan does not list', async () => {
    const run = await dyeingRun();
    const stranger = await makeItem('Stranger');
    await expect(
      receive(
        run.stepId,
        [run.challan.id],
        [run.cotton],
        [
          { itemId: run.dyed, accepted: 400 },
          { itemId: stranger, accepted: 10 },
        ],
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('posts a draft saved before any use was typed, against the challans it ticked', async () => {
    const cotton = await makeItem('Cotton');
    const loose = await makeItem('Loose Dyed', { untracked: true });
    const batch = await seedStock(cotton, 1000, 10);
    const { stepId } = await planStep(
      [{ itemId: cotton, plannedQty: 1000 }],
      [{ itemId: loose, expectedQty: 950, rate: 12 }],
    );
    const challan = await issue(stepId, [{ itemId: cotton, batchId: batch.id, qty: 1000 }]);

    const draft = await receive(
      stepId,
      [challan.id],
      [cotton],
      [{ itemId: loose, accepted: 500 }],
      {},
      'draft',
    );
    expect(draft.status).toBe('draft');

    const posted = await postJobReceiptDraft(orgId, draft.id);
    expect(posted.status).toBe('posted');
    expect(posted.outputs[0]!.materialValue.toString()).toBe('5263.158');
  });
});

describe('receipt — the plan it is costed by', { timeout: 120_000 }, () => {
  it('16: splits by the recipe frozen on the job order, not a later edit to it', async () => {
    // Two inputs, so the recipes decide the split — one input with two outputs would
    // be split by share instead (R1b). The dye is stocked at ₹0 to keep the figures.
    const cotton = await makeItem('Cotton');
    const dye = await makeItem('Dye');
    const red = await makeItem('Red', { composite: true });
    const green = await makeItem('Green', { composite: true });
    await recipe(red, [
      [cotton, 1],
      [dye, 0.1],
    ]);
    await recipe(green, [
      [cotton, 1],
      [dye, 0.1],
    ]);
    const batch = await seedStock(cotton, 200, 10);
    const dyeBatch = await seedStock(dye, 20, 0);
    const { stepId } = await planStep(
      [
        { itemId: cotton, plannedQty: 200 },
        { itemId: dye, plannedQty: 20 },
      ],
      [
        { itemId: red, expectedQty: 100 },
        { itemId: green, expectedQty: 100 },
      ],
    );
    const challan = await issue(stepId, [
      { itemId: cotton, batchId: batch.id, qty: 200 },
      { itemId: dye, batchId: dyeBatch.id, qty: 20 },
    ]);

    // Green now takes three metres a piece — on the item, after the order froze it.
    // Read live, it would carry 750 of the 1,000 and Red only 250.
    await runAsTenant(orgId, (tx) =>
      tx.compositeItemComponent.updateMany({
        where: { organizationId: orgId, compositeItemId: green },
        data: { qtyPerUnit: 3 },
      }),
    );

    const receipt = await receive(
      stepId,
      [challan.id],
      [cotton, dye],
      [
        { itemId: red, accepted: 50 },
        { itemId: green, accepted: 50 },
      ],
    );
    const material = new Map(
      receipt.outputs.map((row) => [row.itemId, row.materialValue.toString()]),
    );
    expect(material.get(red)).toBe('500');
    expect(material.get(green)).toBe('500');
  });

  it('G: refuses a typed Used above what is still out, and a draft keeps a typed figure', async () => {
    const cotton = await makeItem('Cotton');
    const loose = await makeItem('Loose Dyed', { untracked: true });
    const batch = await seedStock(cotton, 1000, 10);
    const { stepId } = await planStep(
      [{ itemId: cotton, plannedQty: 1000 }],
      [{ itemId: loose, expectedQty: 950, rate: 12 }],
    );
    const challan = await issue(stepId, [{ itemId: cotton, batchId: batch.id, qty: 1000 }]);

    await expect(
      receive(stepId, [challan.id], [cotton], [{ itemId: loose, accepted: 500 }], {
        [cotton]: 1200,
      }),
    ).rejects.toMatchObject({ status: 400 });

    const draft = await receive(
      stepId,
      [challan.id],
      [cotton],
      [{ itemId: loose, accepted: 500 }],
      { [cotton]: 540 },
      'draft',
    );
    expect(draft.lines.reduce((sum, line) => sum + Number(line.issuedQty), 0)).toBe(540);

    const posted = await postJobReceiptDraft(orgId, draft.id);
    expect(posted.outputs[0]!.materialValue.toString()).toBe('5400');
  });
});
