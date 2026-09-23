import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { deleteTestOrganization, uniqueOrgCode } from '../../../db/testTenant.ts';
import {
  createBill,
  deleteBill,
  getOpenJobReceiptsForVendor,
  updateBill,
} from './bills.service.ts';
import type { CreateBillPayload } from './bills.schemas.ts';
import { createBatch, postMovement } from '../../inventory/stock-ledger/stockLedger.service.ts';
import { getInventoryValuationSummary } from '../../reports/inventory-valuation/inventoryValuation.service.ts';
import { getStockSummaryReport } from '../../reports/stock-summary/stockSummary.service.ts';
import { getFifoCostLotTracking } from '../../reports/fifo-cost-lot-tracking/fifoCostLotTracking.service.ts';
import type { FifoCostLotTrackingQuery } from '../../reports/fifo-cost-lot-tracking/fifoCostLotTracking.schemas.ts';
import { SOURCE_DOC_TYPES, runAsDocument } from '../../jobwork/jobwork.types.ts';
import { createNewProcess } from '../../jobwork/processes/processes.service.ts';
import { createNewJobOrder } from '../../jobwork/job-orders/jobOrders.service.ts';
import { createNewJobIssue } from '../../jobwork/issues/jobIssues.service.ts';
import {
  cancelJobReceipt,
  createNewJobReceipt,
} from '../../jobwork/receipts/jobReceipts.service.ts';
import { itemsService } from '../../items/items.service.ts';

/**
 * 🔴 JOB WORK IS VALUED AT RECEIPT; THE JOB WORKER'S BILL SETTLES THE CHARGE
 * (2026-09-23). A receipt counts in the reports the day it posts, a bill raised
 * against it carries a SERVICE line and posts nothing, and a receipt sits on one
 * live bill at a time. Every row is created here and hard-deleted afterwards.
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let userId: string;
let metreId: string;
let godownId: string;
let dyerId: string;
let otherVendorId: string;
let processId: string;
let serviceId: string;

async function makeItem(name: string, type: 'goods' | 'service' = 'goods') {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name: `${name} ${unique()}`,
        sku: `JRB-${unique()}`,
        unit: 'Metre',
        stockingUomId: metreId,
        itemType: type,
        inventoryTracking: type === 'goods' ? 'batch' : 'none',
        trackInventory: type === 'goods',
      },
      select: { id: true, name: true },
    });
    return item;
  });
}

async function stockIn(itemId: string, qty: number, value: number) {
  return runAsDocument(orgId, async (tx) => {
    const batch = await createBatch(tx, {
      organizationId: orgId,
      itemId,
      supplierBatchRef: `B-${unique()}`,
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
      postedAt: new Date('2026-09-10T00:00:00Z'),
    });
    return batch;
  });
}

/** 100 m fabric @ ₹50 sent to the dyer and received back as 100 m dyed at ₹10/m —
 * in one batch, or split across two batches of 50. */
async function receivedDyedFabric(opts: { twoBatches?: boolean } = {}) {
  const fabric = await makeItem('Fabric');
  const dyed = await makeItem('Dyed');
  const batch = await stockIn(fabric.id, 100, 5000);
  const jo = await createNewJobOrder(orgId, {
    steps: [
      {
        processId,
        processorType: 'vendor',
        processorId: dyerId,
        inputs: [{ itemId: fabric.id, plannedQty: 100 }],
        outputs: [{ itemId: dyed.id, isPrimary: true, expectedQty: 100, rate: 10 }],
      },
    ],
  });
  const stepId = jo.steps[0]!.id;
  const challan = await createNewJobIssue(orgId, {
    jobOrderStepId: stepId,
    sourceLocationId: godownId,
    lines: [{ itemId: fabric.id, batchId: batch.id, qty: 100 }],
  });
  const receipt = await createNewJobReceipt(orgId, {
    jobOrderStepId: stepId,
    issueIds: [challan.id],
    locationId: godownId,
    lines: [{ itemId: fabric.id, issuedQty: 100, receivedQty: 0 }],
    outputs: [
      {
        itemId: dyed.id,
        isPrimary: true,
        receivedQty: 100,
        acceptedQty: 100,
        ...(opts.twoBatches
          ? {
              batches: [
                { batchReference: `OUT-A-${unique()}`, qty: 50 },
                { batchReference: `OUT-B-${unique()}`, qty: 50 },
              ],
            }
          : { batchReference: `OUT-${unique()}` }),
      },
    ],
  });
  return { fabric, dyed, receipt };
}

function chargeBill(
  receiptId: string,
  itemId: string,
  opts: { vendorId?: string; status?: string } = {},
): CreateBillPayload {
  return {
    vendorId: opts.vendorId ?? dyerId,
    locationId: godownId,
    sourcePoId: null,
    billNumber: `JW-${unique()}`,
    billDate: new Date(),
    dueDate: null,
    subTotal: 900,
    totalAmount: 900,
    status: opts.status ?? 'Open',
    lineItems: [{ itemId, jobReceiptId: receiptId, quantity: 100, rate: 9, amount: 900 }],
  } as CreateBillPayload;
}

const valuationOf = async (name: string) =>
  (
    await getInventoryValuationSummary(orgId, {
      itemName: name,
      stockAvailability: 'none',
      status: 'all',
      page: 1,
      perPage: 25,
    })
  ).results[0]!;

beforeAll(async () => {
  orgId = (
    await prisma.organization.create({
      data: { name: `bill-receipt-${unique()}`, orgCode: uniqueOrgCode() },
      select: { id: true },
    })
  ).id;
  userId = (
    await prisma.user.create({
      data: {
        email: `bill-receipt-${unique()}@example.test`,
        passwordHash: 'x',
        firstName: 'Bill',
        fullName: 'Bill Tester',
      },
      select: { id: true },
    })
  ).id;

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
    const vendor = (name: string) =>
      tx.vendor.create({
        data: {
          organizationId: orgId,
          contactName: name,
          contactNumber: `VEN-${unique()}`,
          vendorTypes: ['job_worker'],
        },
        select: { id: true },
      });
    dyerId = (await vendor('Sunrise Dyers')).id;
    otherVendorId = (await vendor('Other Dyers')).id;
  });
  processId = (await createNewProcess(orgId, { name: `Dyeing ${unique()}` })).id;
  serviceId = (await makeItem('Dyeing charges', 'service')).id;
});

afterAll(async () => {
  if (!orgId) return deleteTestOrganization(orgId);
  await runAsTenant(orgId, async (tx) => {
    await tx.billActivity.deleteMany({ where: { bill: { organizationId: orgId } } });
    await tx.billItemBatch.deleteMany({ where: { organizationId: orgId } });
    await tx.billItem.deleteMany({ where: { bill: { organizationId: orgId } } });
    await tx.bill.deleteMany({ where: { organizationId: orgId } });
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
    await tx.itemActivity.deleteMany({ where: { item: { organizationId: orgId } } });
    await tx.item.deleteMany({ where: { organizationId: orgId } });
    await tx.location.deleteMany({ where: { organizationId: orgId } });
    await tx.vendor.deleteMany({ where: { organizationId: orgId } });
    await tx.unitOfMeasurement.deleteMany({ where: { organizationId: orgId } });
    await tx.numberSequence.deleteMany({ where: { organizationId: orgId } });
  });
  await deleteTestOrganization(orgId);
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe('a job receipt counts when it posts', { timeout: 120_000 }, () => {
  it('shows in valuation and stock summary before any bill, at material + charge', async () => {
    const { dyed } = await receivedDyedFabric();

    const valued = await valuationOf(dyed.name);
    expect(valued.stockOnHand).toBe(100);
    expect(valued.inventoryAssetValue).toBe(6000); // ₹5,000 fabric + 100 × ₹10

    const summary = await getStockSummaryReport(orgId, {
      itemName: dyed.name,
      status: 'all',
      page: 1,
      perPage: 25,
    });
    expect(summary.results[0]!.closingStock).toBe(100);
  });

  it('FIFO lot tracking shows a receipt split over two batches as one lot of 100 (JR-00085)', async () => {
    const { dyed, receipt } = await receivedDyedFabric({ twoBatches: true });
    const report = await getFifoCostLotTracking(orgId, {
      itemName: dyed.name,
      reportBasis: 'product_in',
      page: 1,
      perPage: 25,
    } as FifoCostLotTrackingQuery);
    const lots = report.results.filter((row) => row.inDocId === receipt.id);
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ inQty: 100, inQtyRemaining: 100, inTotal: '6000.00' });
  });

  it('a bill at a different rate changes nothing in stock', async () => {
    const { dyed, receipt } = await receivedDyedFabric();
    await createBill(orgId, userId, chargeBill(receipt.id, serviceId));

    const valued = await valuationOf(dyed.name);
    expect(valued.inventoryAssetValue).toBe(6000);
    const billRows = await runAsTenant(orgId, (tx) =>
      tx.stockLedgerEntry.count({ where: { organizationId: orgId, sourceDocType: 'bill' } }),
    );
    expect(billRows).toBe(0);
  });
});

describe('a bill against a job receipt', { timeout: 120_000 }, () => {
  it('refuses a goods item on the receipt line', async () => {
    const { dyed, receipt } = await receivedDyedFabric();
    await expect(createBill(orgId, userId, chargeBill(receipt.id, dyed.id))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('refuses a service saved with inventory tracking on, naming it', async () => {
    const { receipt } = await receivedDyedFabric();
    // Written directly: the item form no longer lets a service track stock.
    const tracked = await runAsTenant(orgId, (tx) =>
      tx.item.create({
        data: {
          organizationId: orgId,
          name: `Old Cutting ${unique()}`,
          sku: `JRB-${unique()}`,
          unit: 'Metre',
          itemType: 'service',
          inventoryTracking: 'none',
          trackInventory: true,
        },
        select: { id: true, name: true },
      }),
    );
    await expect(
      createBill(orgId, userId, chargeBill(receipt.id, tracked.id)),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining(tracked.name) });
  });

  it('refuses a receipt from a different processor', async () => {
    const { receipt } = await receivedDyedFabric();
    await expect(
      createBill(orgId, userId, chargeBill(receipt.id, serviceId, { vendorId: otherVendorId })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('holds a receipt on one live bill; deleting the bill frees it', async () => {
    const { receipt } = await receivedDyedFabric();
    const first = await createBill(
      orgId,
      userId,
      chargeBill(receipt.id, serviceId, { status: 'Draft' }),
    );

    await expect(
      createBill(orgId, userId, chargeBill(receipt.id, serviceId)),
    ).rejects.toMatchObject({ status: 409 });
    const open = await getOpenJobReceiptsForVendor(orgId, dyerId);
    expect(open.map((row) => row.id)).not.toContain(receipt.id);

    // Re-saving the same bill is not a second bill.
    await updateBill(orgId, first.id, userId, { status: 'Open' });

    await deleteBill(orgId, first.id, userId);
    const reopened = await getOpenJobReceiptsForVendor(orgId, dyerId);
    expect(reopened.map((row) => row.id)).toContain(receipt.id);
  });

  it('blocks cancelling the receipt while it is billed', async () => {
    const { receipt } = await receivedDyedFabric();
    const bill = await createBill(orgId, userId, chargeBill(receipt.id, serviceId));

    await expect(cancelJobReceipt(orgId, receipt.id, 'wrong')).rejects.toMatchObject({
      status: 409,
    });
    await deleteBill(orgId, bill.id, userId);
    await expect(cancelJobReceipt(orgId, receipt.id, 'wrong')).resolves.toBeDefined();
  });
});

describe('a service item is never stocked', { timeout: 60_000 }, () => {
  it('refuses a service with inventory tracking on', async () => {
    await expect(
      itemsService.create(orgId, {
        name: `Stitching ${unique()}`,
        itemType: 'service',
        trackInventory: true,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses deleting an item that still has stock, and deletes one that has none', async () => {
    const stocked = await makeItem('Stocked');
    await stockIn(stocked.id, 10, 100);
    await expect(itemsService.delete(stocked.id, orgId)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('still has 10 in stock'),
    });

    const empty = await makeItem('Empty');
    await expect(itemsService.delete(empty.id, orgId)).resolves.toBeDefined();
  });

  it('refuses turning an item with stock movements into a service', async () => {
    const fabric = await makeItem('Moved');
    await stockIn(fabric.id, 10, 100);
    await expect(
      itemsService.update(fabric.id, orgId, { itemType: 'service', trackInventory: false }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
