import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { deleteTestOrganization, uniqueOrgCode } from '../../../db/testTenant.ts';
import { createBill, updateBill } from './bills.service.ts';
import type { CreateBillPayload } from './bills.schemas.ts';
import { getBalance, postMovement } from '../../inventory/stock-ledger/stockLedger.service.ts';
import { checkLayerInvariant } from '../../inventory/stock-ledger/costLayers.ts';
import { getInventoryValuationSummary } from '../../reports/inventory-valuation/inventoryValuation.service.ts';

/**
 * 🔴 BILLS UNDER FIFO (docs/FIFO_COSTING_PLAN.md §5.1): a layer carries the line's
 * NET amount, an edit takes back only an untouched layer (D3), and the edit's
 * reversal is dated at the bill's own date so an as-of report shows it once.
 *
 * Each test mints its own item, so its FIFO queue is its own. Every row is created
 * here and hard-deleted afterwards (CLAUDE.md).
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let userId: string;
let uomId: string;
let vendorId: string;
let locationId: string;

async function makeItem() {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name: `Bill FIFO ${unique()}`,
        sku: `BILL-FIFO-${unique()}`,
        unit: 'Metre',
        stockingUomId: uomId,
        inventoryTracking: 'batch',
        trackInventory: true,
      },
      select: { id: true, name: true },
    });
    return item;
  });
}

function line(itemId: string, quantity: number, rate: number, discountAmount = 0) {
  return {
    itemId,
    quantity,
    rate,
    discountAmount,
    amount: quantity * rate - discountAmount,
    batches: [{ supplierBatchRef: `B-${unique()}`, quantity }],
  };
}

function billPayload(lines: ReturnType<typeof line>[], billDate: Date): CreateBillPayload {
  const total = lines.reduce((sum, row) => sum + row.amount, 0);
  return {
    vendorId,
    locationId,
    sourcePoId: null,
    billNumber: `BILL-${unique()}`,
    billDate,
    dueDate: null,
    subTotal: total,
    totalAmount: total,
    status: 'Open',
    lineItems: lines,
  } as CreateBillPayload;
}

const worth = (itemId: string) =>
  runAsTenant(orgId, (tx) =>
    getBalance(tx, { organizationId: orgId, itemId, locationId, ownership: 'own' }),
  );

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `bill-fifo-${unique()}`, orgCode: uniqueOrgCode() },
    select: { id: true },
  });
  orgId = org.id;

  userId = (
    await prisma.user.create({
      data: {
        email: `bill-fifo-${unique()}@example.test`,
        passwordHash: 'x',
        firstName: 'Bill',
        fullName: 'Bill Tester',
      },
      select: { id: true },
    })
  ).id;

  await runAsTenant(orgId, async (tx) => {
    uomId = (
      await tx.unitOfMeasurement.create({
        data: { organizationId: orgId, unitName: 'Metre', symbol: 'MTR' },
        select: { id: true },
      })
    ).id;
    vendorId = (
      await tx.vendor.create({
        data: {
          organizationId: orgId,
          contactName: 'Weaving Mills',
          contactNumber: `VC-${unique()}`,
        },
        select: { id: true },
      })
    ).id;
    locationId = (
      await tx.location.create({
        data: { organizationId: orgId, name: 'Main Godown', type: 'godown' },
        select: { id: true },
      })
    ).id;
  });
});

afterEach(async () => {
  if (!orgId) return;
  expect(await runAsTenant(orgId, (tx) => checkLayerInvariant(tx, orgId))).toEqual([]);
});

afterAll(async () => {
  if (!orgId) return deleteTestOrganization(orgId);
  await runAsTenant(orgId, async (tx) => {
    await tx.stockLedgerEntry.deleteMany({ where: { organizationId: orgId } });
    await tx.billItemBatch.deleteMany({ where: { organizationId: orgId } });
    await tx.batchUnit.deleteMany({ where: { organizationId: orgId } });
    await tx.batch.deleteMany({ where: { organizationId: orgId } });
    await tx.billActivity.deleteMany({ where: { bill: { organizationId: orgId } } });
    await tx.billItem.deleteMany({ where: { bill: { organizationId: orgId } } });
    await tx.bill.deleteMany({ where: { organizationId: orgId } });
    await tx.item.deleteMany({ where: { organizationId: orgId } });
    await tx.vendor.deleteMany({ where: { organizationId: orgId } });
    await tx.location.deleteMany({ where: { organizationId: orgId } });
    await tx.unitOfMeasurement.deleteMany({ where: { organizationId: orgId } });
    await tx.numberSequence.deleteMany({ where: { organizationId: orgId } });
  });
  await deleteTestOrganization(orgId);
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe('bill → FIFO layers', { timeout: 60_000 }, () => {
  it('values a discounted line at qty × rate − discount, not qty × rate', async () => {
    const item = await makeItem();
    await createBill(orgId, userId, billPayload([line(item.id, 100, 10, 150)], new Date()));

    expect((await worth(item.id)).value.toString()).toBe('850');
    const [layer] = await runAsTenant(orgId, (tx) =>
      tx.stockCostLayer.findMany({ where: { organizationId: orgId, itemId: item.id } }),
    );
    expect(layer!.value.toString()).toBe('850');
  });

  it('edits a used bill by the difference, and refuses only what touches used stock', async () => {
    const item = await makeItem();
    const billDate = new Date('2026-09-01T00:00:00Z');
    const older = await createBill(orgId, userId, billPayload([line(item.id, 100, 10)], billDate));
    await createBill(
      orgId,
      userId,
      billPayload([line(item.id, 100, 20)], new Date('2026-09-05T00:00:00Z')),
    );

    // 30 m physically out of the NEWER bill's batch — FIFO costs it to the older one.
    const newerBatch = await runAsTenant(orgId, (tx) =>
      tx.batch.findFirstOrThrow({
        where: { organizationId: orgId, itemId: item.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
    );
    await runAsTenant(orgId, (tx) =>
      postMovement(tx, {
        organizationId: orgId,
        batchId: newerBatch.id,
        locationId,
        movementType: 'adjustment',
        qtyOut: 30,
        sourceDocType: 'test',
      }),
    );
    expect((await worth(item.id)).value.toString()).toBe(String(70 * 10 + 100 * 20));

    // What the edit form sends: the SAME batch back, by id.
    const { batchId } = await runAsTenant(orgId, (tx) =>
      tx.billItemBatch.findFirstOrThrow({
        where: { organizationId: orgId, billItem: { billId: older.id }, isDeleted: false },
        select: { batchId: true },
      }),
    );
    const edit = (quantity: number, rate: number, extra: Record<string, unknown> = {}) =>
      updateBill(orgId, older.id, userId, {
        status: 'Open',
        ...extra,
        lineItems: [
          {
            itemId: item.id,
            quantity,
            rate,
            amount: quantity * rate,
            batches: [{ batchId, quantity }],
          },
        ],
      } as never);
    const rowCount = () =>
      runAsTenant(orgId, (tx) =>
        tx.stockLedgerEntry.count({
          where: { organizationId: orgId, sourceDocType: 'bill', sourceDocId: older.id },
        }),
      );

    // 1. Nothing about stock changed (a note, a due date): allowed, and posts nothing.
    const before = await rowCount();
    await edit(100, 10, { notes: 'Delivered in two lots.', dueDate: new Date('2026-10-01') });
    expect(await rowCount()).toBe(before);

    // 2. More received: only the extra 20 is posted.
    await edit(120, 10);
    expect(await rowCount()).toBe(before + 1);
    expect((await worth(item.id)).value.toString()).toBe(String(90 * 10 + 100 * 20));

    // 3. Less, while that much is still unused: only the 40 is taken back.
    await edit(80, 10);
    expect((await worth(item.id)).qty.toString()).toBe('150');

    // 4. A rate change once some of it is used: refused, by name.
    await expect(edit(80, 12)).rejects.toThrow('rate or discount');
    // 5. So is re-dating it.
    await expect(edit(80, 10, { billDate: new Date('2026-09-03T00:00:00Z') })).rejects.toThrow(
      'bill date cannot change',
    );
    // 6. And taking back more than is still unused (50 of the 80 is left uncosted).
    const tooFar = edit(10, 10);
    await expect(tooFar).rejects.toMatchObject({ status: 409 });
    await expect(tooFar).rejects.toThrow('has already been costed to');
  });

  it('lets an unused bill change its rate, revaluing it', async () => {
    const item = await makeItem();
    const bill = await createBill(orgId, userId, billPayload([line(item.id, 50, 10)], new Date()));
    const { batchId } = await runAsTenant(orgId, (tx) =>
      tx.billItemBatch.findFirstOrThrow({
        where: { organizationId: orgId, billItem: { billId: bill.id }, isDeleted: false },
        select: { batchId: true },
      }),
    );
    await updateBill(orgId, bill.id, userId, {
      status: 'Open',
      lineItems: [
        {
          itemId: item.id,
          quantity: 50,
          rate: 12,
          amount: 600,
          batches: [{ batchId, quantity: 50 }],
        },
      ],
    } as never);
    expect((await worth(item.id)).value.toString()).toBe('600');
  });

  it('an edit made later shows the bill once in an as-of report between the two dates', async () => {
    const item = await makeItem();
    const billDate = new Date('2026-09-02T00:00:00Z');
    const bill = await createBill(orgId, userId, billPayload([line(item.id, 100, 10)], billDate));

    await updateBill(orgId, bill.id, userId, {
      status: 'Open',
      lineItems: [line(item.id, 80, 10)],
    } as never);

    const summary = await getInventoryValuationSummary(orgId, {
      asOfDate: '2026-09-10T00:00:00Z',
      itemName: item.name,
      stockAvailability: 'none',
      status: 'all',
      page: 1,
      perPage: 25,
    });
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]!.stockOnHand).toBe(80);
    expect(summary.results[0]!.inventoryAssetValue).toBe(800);
  });
});
