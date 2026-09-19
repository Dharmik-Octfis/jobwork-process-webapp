import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { Prisma } from '../../../generated/prisma/client.ts';
import { prisma, runAsTenant } from '../../db/prisma.ts';
import { deleteTestOrganization, uniqueOrgCode } from '../../db/testTenant.ts';
import {
  createBatch,
  getBalance,
  postMovement,
  reverseMovement,
} from '../inventory/stock-ledger/stockLedger.service.ts';
import {
  checkLayerInvariant,
  createLayers,
  planLegacyLayers,
} from '../inventory/stock-ledger/costLayers.ts';
import {
  getInventoryValuationSummary,
  getItemLedger,
} from '../reports/inventory-valuation/inventoryValuation.service.ts';
import { SOURCE_DOC_TYPES, runAsDocument } from './jobwork.types.ts';
import { createNewProcess } from './processes/processes.service.ts';
import { createNewJobOrder } from './job-orders/jobOrders.service.ts';
import { cancelJobIssue, createNewJobIssue } from './issues/jobIssues.service.ts';
import { cancelJobReceipt, createNewJobReceipt } from './receipts/jobReceipts.service.ts';

/**
 * 🔴 FIFO COSTING ON REAL POSTINGS (docs/FIFO_COSTING_PLAN.md, "Tests that must
 * exist"). Every scenario mints its own items, so each one has FIFO queues nobody
 * else touches — cost is per item per location, and a shared item would be costed
 * at whatever another test left first.
 *
 * After every test the layers must tie to the ledger (the invariant). Every row is
 * created here and hard-deleted afterwards (CLAUDE.md).
 */

const unique = () => process.hrtime.bigint().toString(36);
const d = (value: string | number | Prisma.Decimal) => new Prisma.Decimal(value);

let orgId: string;
let metreId: string;
let godownId: string;
let dyerId: string;
let processId: string;
let customerId: string;

async function makeItem(name: string) {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name: `${name} ${unique()}`,
        sku: `FIFO-${unique()}`,
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

/** One inward batch, dated — FIFO queues by this date. */
async function stockIn(
  itemId: string,
  qty: number,
  value: number,
  postedAt: Date,
  opts: { movementType?: 'opening' | 'receipt'; ownership?: 'own' | 'customer' } = {},
) {
  return runAsDocument(orgId, async (tx) => {
    const ownership = opts.ownership ?? 'own';
    const batch = await createBatch(tx, {
      organizationId: orgId,
      itemId,
      ownership,
      ownerPartyId: ownership === 'customer' ? customerId : null,
      supplierBatchRef: `B-${unique()}`,
      sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
    });
    await postMovement(tx, {
      organizationId: orgId,
      batchId: batch.id,
      locationId: godownId,
      movementType: opts.movementType ?? 'receipt',
      qtyIn: qty,
      valueIn: value,
      sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
      sourceDocId: batch.id,
      postedAt,
    });
    return batch;
  });
}

async function planStep(inputItemId: string, outputItemId: string, qty: number) {
  const jo = await createNewJobOrder(orgId, {
    steps: [
      {
        processId,
        processorType: 'vendor',
        processorId: dyerId,
        inputs: [{ itemId: inputItemId, plannedQty: qty }],
        outputs: [{ itemId: outputItemId, isPrimary: true, expectedQty: qty }],
      },
    ],
  });
  return jo.steps[0]!.id;
}

async function issue(stepId: string, lines: { itemId: string; batchId: string; qty: number }[]) {
  const challan = await createNewJobIssue(orgId, {
    jobOrderStepId: stepId,
    sourceLocationId: godownId,
    lines,
  });
  return {
    id: challan.id,
    processorLocationId: challan.destinationLocationId,
    lineIds: challan.lines.map((line) => line.id),
  };
}

const receive = (
  stepId: string,
  issueIds: string[],
  inputItemId: string,
  outputItemId: string,
  qty: number,
) =>
  createNewJobReceipt(orgId, {
    jobOrderStepId: stepId,
    issueIds,
    locationId: godownId,
    lines: [{ itemId: inputItemId, issuedQty: qty, receivedQty: 0 }],
    outputs: [
      {
        itemId: outputItemId,
        isPrimary: true,
        receivedQty: qty,
        acceptedQty: qty,
        batchReference: `OUT-${unique()}`,
      },
    ],
  });

/** What an item is worth at one place — the valuation question, not a batch's. */
const worth = async (itemId: string, locationId: string) =>
  runAsTenant(orgId, (tx) =>
    getBalance(tx, { organizationId: orgId, itemId, locationId, ownership: 'own' }),
  );

const layersOf = (itemId: string) =>
  runAsTenant(orgId, (tx) =>
    tx.stockCostLayer.findMany({
      where: { organizationId: orgId, itemId },
      orderBy: [{ inDate: 'asc' }, { inSeq: 'asc' }],
      select: {
        id: true,
        locationId: true,
        sourceDocLineId: true,
        inDate: true,
        remainingQty: true,
        remainingValue: true,
      },
    }),
  );

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `fifo-${unique()}`, orgCode: uniqueOrgCode() },
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
          contactName: 'Principal Mills',
          contactNumber: `CUS-${unique()}`,
        },
        select: { id: true },
      })
    ).id;
  });

  processId = (await createNewProcess(orgId, { name: `Dyeing ${unique()}` })).id;
});

afterEach(async () => {
  if (!orgId) return;
  const mismatches = await runAsTenant(orgId, (tx) => checkLayerInvariant(tx, orgId));
  expect(mismatches).toEqual([]);
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
    // Cascades to `stock_cost_layers` and `stock_layer_draws`.
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

const SEP_06 = new Date('2026-09-06T00:00:00Z');
const SEP_18 = new Date('2026-09-18T00:00:00Z');

describe('FIFO — the worked example (plan §1)', { timeout: 120_000 }, () => {
  it('opening ₹50 + bill ₹30, issue 50 + 50, receive 51 → ₹3,000 / ₹5,000 / ₹2,550', async () => {
    const green = await makeItem('Green Fabric');
    const dyed = await makeItem('Dyed Green');
    const opening = await stockIn(green, 100, 5000, SEP_06, { movementType: 'opening' });
    const bill = await stockIn(green, 100, 3000, SEP_18);

    const stepId = await planStep(green, dyed, 100);
    const challan = await issue(stepId, [
      { itemId: green, batchId: opening.id, qty: 50 },
      { itemId: green, batchId: bill.id, qty: 50 },
    ]);

    // 100 × ₹50, oldest first — whichever batches were physically picked.
    expect((await worth(green, godownId)).value.toString()).toBe('3000');
    expect((await worth(green, challan.processorLocationId)).value.toString()).toBe('5000');

    const receipt = await receive(stepId, [challan.id], green, dyed, 51);
    expect(receipt.consumedValue.toString()).toBe('2550');

    // Godown + dyer tie to what came in, less what the receipt consumed.
    expect((await worth(green, challan.processorLocationId)).value.toString()).toBe('2450');

    // Report = ledger: the Summary and the Item Ledger read the same ₹3,000 the
    // ledger holds at the godown (processor stock is outside both, as before).
    const { name } = await runAsTenant(orgId, (tx) =>
      tx.item.findFirstOrThrow({ where: { id: green }, select: { name: true } }),
    );
    const summary = await getInventoryValuationSummary(orgId, {
      itemName: name,
      stockAvailability: 'none',
      status: 'all',
      page: 1,
      perPage: 25,
    });
    expect(summary.results[0]!.inventoryAssetValue).toBe(3000);
    const ledger = await getItemLedger(orgId, green, {});
    expect(ledger.rows.at(-1)!.inventoryAssetValue).toBe(3000);
    expect(ledger.rows.at(-1)!.stockOnHand).toBe(100);
  });

  it('picking the newer batch still costs the oldest layer', async () => {
    const fabric = await makeItem('Fabric');
    const dyed = await makeItem('Dyed');
    await stockIn(fabric, 100, 5000, SEP_06);
    const newer = await stockIn(fabric, 100, 3000, SEP_18);

    const stepId = await planStep(fabric, dyed, 50);
    const challan = await issue(stepId, [{ itemId: fabric, batchId: newer.id, qty: 50 }]);

    expect((await worth(fabric, challan.processorLocationId)).value.toString()).toBe('2500');
    expect((await worth(fabric, godownId)).value.toString()).toBe('5500');
  });
});

describe('FIFO — a challan posted before FIFO (JI-00116)', { timeout: 120_000 }, () => {
  it('is re-costed by cancelling and issuing it again: ₹4,000 → ₹3,000 / ₹5,000 / ₹2,550', async () => {
    const green = await makeItem('Legacy Green');
    const dyed = await makeItem('Legacy Dyed');
    const opening = await stockIn(green, 100, 5000, SEP_06, { movementType: 'opening' });
    const bill = await stockIn(green, 100, 3000, SEP_18);
    const stepId = await planStep(green, dyed, 100);
    const old = await issue(stepId, [
      { itemId: green, batchId: opening.id, qty: 50 },
      { itemId: green, batchId: bill.id, qty: 50 },
    ]);

    /* Rewind it to what the OLD code wrote — each line at its own batch's average
       (₹2,500 + ₹1,500) and no layers — then run the cut-over, exactly the state
       `jobwork_local` was left in. */
    await runAsTenant(orgId, async (tx) => {
      await tx.stockLayerDraw.deleteMany({
        where: { organizationId: orgId, layer: { itemId: green } },
      });
      await tx.stockCostLayer.deleteMany({ where: { organizationId: orgId, itemId: green } });
      for (const [batchId, value] of [
        [opening.id, 2500],
        [bill.id, 1500],
      ] as const) {
        await tx.stockLedgerEntry.updateMany({
          where: { organizationId: orgId, batchId, sourceDocType: 'job_issue', qtyOut: { gt: 0 } },
          data: { valueOut: value },
        });
        await tx.stockLedgerEntry.updateMany({
          where: { organizationId: orgId, batchId, sourceDocType: 'job_issue', qtyIn: { gt: 0 } },
          data: { valueIn: value },
        });
      }
      const plan = await planLegacyLayers(tx, orgId);
      await createLayers(tx, orgId, plan.layers);
    });
    expect((await worth(green, godownId)).value.toString()).toBe('4000');

    await cancelJobIssue(orgId, old.id, 'Re-cost under FIFO');
    const fresh = await issue(stepId, [
      { itemId: green, batchId: opening.id, qty: 50 },
      { itemId: green, batchId: bill.id, qty: 50 },
    ]);

    expect((await worth(green, godownId)).value.toString()).toBe('3000');
    expect((await worth(green, fresh.processorLocationId)).value.toString()).toBe('5000');
    const receipt = await receive(stepId, [fresh.id], green, dyed, 51);
    expect(receipt.consumedValue.toString()).toBe('2550');
  });
});

describe(
  'FIFO — cancelling a pre-FIFO challan whose goods moved on (JI-00094)',
  { timeout: 120_000 },
  () => {
    it('refuses, naming the challan that took the goods onward', async () => {
      const fabric = await makeItem('Moved Fabric');
      const dyed = await makeItem('Moved Dyed');
      const batch = await stockIn(fabric, 60, 6000, SEP_06);
      const stepId = await planStep(fabric, dyed, 60);
      const old = await issue(stepId, [{ itemId: fabric, batchId: batch.id, qty: 60 }]);

      // Rewind to the pre-FIFO state: no layers, then the cut-over.
      await runAsTenant(orgId, async (tx) => {
        await tx.stockLayerDraw.deleteMany({
          where: { organizationId: orgId, layer: { itemId: fabric } },
        });
        await tx.stockCostLayer.deleteMany({ where: { organizationId: orgId, itemId: fabric } });
        await createLayers(tx, orgId, (await planLegacyLayers(tx, orgId)).layers);
      });

      /* Another challan sends all 60 onward from the dyer — the JI-00096 shape. The
       onward row is posted by hand because an issue FROM a processor location is
       not something this fixture's job orders can plan; what matters is the
       document it names. */
      const nextItem = await makeItem('Next Step Input');
      const nextBatch = await stockIn(nextItem, 5, 50, SEP_06);
      const onwardChallan = await issue(await planStep(nextItem, dyed, 5), [
        { itemId: nextItem, batchId: nextBatch.id, qty: 5 },
      ]);
      const onward = await runAsTenant(orgId, (tx) =>
        tx.jobIssue.findFirstOrThrow({
          where: { id: onwardChallan.id },
          select: { id: true, challanNumber: true },
        }),
      );
      await runAsDocument(orgId, (tx) =>
        postMovement(tx, {
          organizationId: orgId,
          batchId: batch.id,
          locationId: old.processorLocationId,
          movementType: 'transfer_out',
          qtyOut: 60,
          sourceDocType: 'job_issue',
          sourceDocId: onward.id,
        }),
      );

      const cancel = cancelJobIssue(orgId, old.id, 'test');
      await expect(cancel).rejects.toMatchObject({ status: 409 });
      await expect(cancel).rejects.toThrow(`used by challan ${onward.challanNumber}`);
    });
  },
);

describe('FIFO — processor layers', { timeout: 120_000 }, () => {
  it('a transfer keeps its age: the older layer at the processor is consumed first', async () => {
    const fabric = await makeItem('Aged Fabric');
    const dyed = await makeItem('Aged Dyed');
    const older = await stockIn(fabric, 100, 5000, SEP_06);
    const newer = await stockIn(fabric, 100, 3000, SEP_18);

    const stepId = await planStep(fabric, dyed, 200);
    await issue(stepId, [{ itemId: fabric, batchId: older.id, qty: 50 }]);
    // Draws the last 50 of the ₹50 layer and 50 of the ₹30 one.
    const second = await issue(stepId, [{ itemId: fabric, batchId: newer.id, qty: 100 }]);

    const atDyer = (await layersOf(fabric)).filter(
      (layer) => layer.sourceDocLineId === second.lineIds[0],
    );
    expect(atDyer.map((layer) => layer.inDate.toISOString())).toEqual([
      SEP_06.toISOString(),
      SEP_18.toISOString(),
    ]);

    const receipt = await receive(stepId, [second.id], fabric, dyed, 60);
    expect(receipt.consumedValue.toString()).toBe(String(50 * 50 + 10 * 30));
  });

  it("two job orders at one processor never consume each other's layers", async () => {
    const fabric = await makeItem('Shared Fabric');
    const dyed = await makeItem('Shared Dyed');
    const dear = await stockIn(fabric, 100, 9000, SEP_06);
    const cheap = await stockIn(fabric, 100, 1000, SEP_18);

    const stepA = await planStep(fabric, dyed, 100);
    const stepB = await planStep(fabric, dyed, 100);
    const challanA = await issue(stepA, [{ itemId: fabric, batchId: dear.id, qty: 100 }]);
    const challanB = await issue(stepB, [{ itemId: fabric, batchId: cheap.id, qty: 100 }]);
    expect(challanA.processorLocationId).toBe(challanB.processorLocationId);

    // Job B receives first; plain location-FIFO would hand it job A's ₹90 layer.
    const receiptB = await receive(stepB, [challanB.id], fabric, dyed, 100);
    expect(receiptB.consumedValue.toString()).toBe('1000');
    const receiptA = await receive(stepA, [challanA.id], fabric, dyed, 100);
    expect(receiptA.consumedValue.toString()).toBe('9000');
  });
});

describe('FIFO — reversals restore layers exactly', { timeout: 120_000 }, () => {
  it('cancelling a receipt, then its challan, puts every layer back to the paisa', async () => {
    const fabric = await makeItem('Undo Fabric');
    const dyed = await makeItem('Undo Dyed');
    // ₹10 over 3 m: a unit cost that does not divide evenly.
    const odd = await stockIn(fabric, 3, 10, SEP_06);
    await stockIn(fabric, 7, 21, SEP_18);
    const before = await layersOf(fabric);

    const stepId = await planStep(fabric, dyed, 5);
    const challan = await issue(stepId, [{ itemId: fabric, batchId: odd.id, qty: 3 }]);
    const receipt = await receive(stepId, [challan.id], fabric, dyed, 2);
    expect(receipt.consumedValue.toString()).toBe('6.6667');

    await cancelJobReceipt(orgId, receipt.id, 'test');
    await cancelJobIssue(orgId, challan.id, 'test');

    const after = await layersOf(fabric);
    const godownBefore = before.map((l) => [
      l.id,
      l.remainingQty.toString(),
      l.remainingValue.toString(),
    ]);
    const godownAfter = after
      .filter((layer) => layer.locationId === godownId)
      .map((l) => [l.id, l.remainingQty.toString(), l.remainingValue.toString()]);
    expect(godownAfter).toEqual(godownBefore);
    // Nothing left standing at the dyer's.
    expect(
      after
        .filter((layer) => layer.locationId !== godownId)
        .every((layer) => layer.remainingQty.isZero() && layer.remainingValue.isZero()),
    ).toBe(true);
  });
});

describe('FIFO — refusals', { timeout: 120_000 }, () => {
  it('refuses an outward row that would take more than the layers hold', async () => {
    const fabric = await makeItem('Short Fabric');
    const batch = await stockIn(fabric, 10, 100, SEP_06);
    await expect(
      runAsDocument(orgId, (tx) =>
        postMovement(tx, {
          organizationId: orgId,
          batchId: batch.id,
          locationId: godownId,
          movementType: 'adjustment',
          qtyOut: 11,
          sourceDocType: 'test',
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses reversing an inward row whose layer was costed away — naming the consumer (D3)', async () => {
    const fabric = await makeItem('Consumed Fabric');
    const dyed = await makeItem('Consumed Dyed');
    const batch = await stockIn(fabric, 10, 100, SEP_06);
    const other = await stockIn(fabric, 10, 50, SEP_18);
    const stepId = await planStep(fabric, dyed, 5);
    // Physically the NEWER batch — FIFO still draws the older batch's layer.
    const challan = await issue(stepId, [{ itemId: fabric, batchId: other.id, qty: 5 }]);
    const { challanNumber } = await runAsTenant(orgId, (tx) =>
      tx.jobIssue.findFirstOrThrow({ where: { id: challan.id }, select: { challanNumber: true } }),
    );

    const inward = await runAsTenant(orgId, (tx) =>
      tx.stockLedgerEntry.findFirstOrThrow({
        where: { organizationId: orgId, batchId: batch.id, qtyIn: { gt: 0 } },
        select: { id: true },
      }),
    );
    const attempt = runAsDocument(orgId, (tx) =>
      reverseMovement(tx, orgId, inward.id, { sourceDocType: 'test' }),
    );
    await expect(attempt).rejects.toMatchObject({ status: 409 });
    await expect(attempt).rejects.toThrow(challanNumber);
  });
});

describe('FIFO — what never gets a layer', { timeout: 60_000 }, () => {
  it('customer-owned stock: no layers, zero value, quantity still moves', async () => {
    const fabric = await makeItem('Customer Fabric');
    const batch = await stockIn(fabric, 40, 999, SEP_06, { ownership: 'customer' });

    await runAsDocument(orgId, (tx) =>
      postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        locationId: godownId,
        movementType: 'adjustment',
        qtyOut: 15,
        sourceDocType: 'test',
      }),
    );

    expect(await layersOf(fabric)).toEqual([]);
    const balance = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId: batch.id }),
    );
    expect(balance.qty.toString()).toBe('25');
    expect(balance.value.toString()).toBe('0');
  });
});

describe('FIFO — concurrency', { timeout: 60_000 }, () => {
  it('two parallel draws on one item+location never over-draw a layer', async () => {
    const fabric = await makeItem('Race Fabric');
    const batch = await stockIn(fabric, 100, 1000, SEP_06);

    const draw = () =>
      runAsDocument(orgId, (tx) =>
        postMovement(tx, {
          organizationId: orgId,
          batchId: batch.id,
          locationId: godownId,
          movementType: 'adjustment',
          qtyOut: 60,
          sourceDocType: 'test',
        }),
      );
    const results = await Promise.allSettled([draw(), draw()]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const [layer] = await layersOf(fabric);
    expect(layer!.remainingQty.equals(d(40))).toBe(true);
    expect(layer!.remainingValue.equals(d(400))).toBe(true);
  });
});
