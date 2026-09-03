import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { deleteTestOrganization, uniqueOrgCode } from '../../../db/testTenant.ts';
import { createBill, updateBill } from './bills.service.ts';
import {
  getBalance,
  getBalancesByBatchUnit,
} from '../../inventory/stock-ledger/stockLedger.service.ts';
import type { CreateBillPayload } from './bills.schemas.ts';

/**
 * 🔴 THE PROOF THAT THE UNIT LEVEL WORKS ON A REAL DOCUMENT.
 *
 * Bills is the right probe for this and was chosen deliberately: it already reads
 * its batch list back OFF THE LEDGER rather than storing one, so if a bill can
 * write units and read them back, the premise the whole design rests on — that a
 * unit is a ledger dimension and needs no table of its own to hold a quantity —
 * holds for every surface that follows.
 *
 * The two Phase-0 defects this path carried are pinned here too. Both predate
 * units and both get worse under them, which is why they are fixed in the same
 * commit rather than left for later.
 *
 * 🔴 Every row is created here and hard-deleted afterwards — suites run against
 * the dev database IN PARALLEL.
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let userId: string;
let itemId: string;
let uomId: string;
let vendorId: string;
let locationId: string;

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `bill-units-${unique()}`, orgCode: uniqueOrgCode() },
    select: { id: true },
  });
  orgId = org.id;

  const user = await prisma.user.create({
    data: {
      email: `bill-units-${unique()}@example.test`,
      passwordHash: 'x',
      firstName: 'Bill',
      fullName: 'Bill Tester',
    },
    select: { id: true },
  });
  userId = user.id;

  await runAsTenant(orgId, async (tx) => {
    const uom = await tx.unitOfMeasurement.create({
      data: { organizationId: orgId, unitName: 'Metre', symbol: 'MTR' },
      select: { id: true },
    });
    uomId = uom.id;

    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name: 'Grey Fabric',
        sku: `BILL-UNITS-${unique()}`,
        unit: 'Metre',
        stockingUomId: uomId,
        inventoryTracking: 'batch',
        trackInventory: true,
      },
      select: { id: true },
    });
    itemId = item.id;

    const vendor = await tx.vendor.create({
      data: {
        organizationId: orgId,
        contactName: 'Weaving Mills',
        contactNumber: `VC-${unique()}`,
      },
      select: { id: true },
    });
    vendorId = vendor.id;

    const location = await tx.location.create({
      data: { organizationId: orgId, name: 'Main Godown', type: 'godown' },
      select: { id: true },
    });
    locationId = location.id;
  });
});

afterAll(async () => {
  await runAsTenant(orgId, async (tx) => {
    await tx.stockLedgerEntry.deleteMany({ where: { organizationId: orgId } });
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

function billPayload(
  batches: CreateBillPayload['lineItems'][number]['batches'],
  status = 'Open',
  quantity = 5000,
): CreateBillPayload {
  return {
    vendorId,
    locationId,
    sourcePoId: null,
    billNumber: `BILL-${unique()}`,
    billDate: new Date(),
    dueDate: null,
    subTotal: quantity * 10,
    totalAmount: quantity * 10,
    status,
    lineItems: [{ itemId, quantity, rate: 10, amount: quantity * 10, batches }],
  } as CreateBillPayload;
}

describe('bill → units → ledger', () => {
  it('posts one movement per unit, and the batch total is their sum', async () => {
    const bill = await createBill(
      orgId,
      userId,
      billPayload([
        {
          supplierBatchRef: `JV-${unique()}`,
          quantity: 5000,
          units: [
            { label: 'T-1', quantity: 1700 },
            { label: 'T-2', quantity: 400 },
            { label: 'T-3', quantity: 2900 },
          ],
        },
      ]),
    );

    const { batchId, rows, byUnit, balance } = await runAsTenant(orgId, async (tx) => {
      const ledger = await tx.stockLedgerEntry.findMany({
        where: { organizationId: orgId, sourceDocType: 'bill', sourceDocId: bill.id },
        include: { batchUnit: { select: { label: true, seq: true } } },
      });
      const id = ledger[0]!.batchId;
      return {
        batchId: id,
        rows: ledger,
        byUnit: (await getBalancesByBatchUnit(tx, { organizationId: orgId, batchIds: [id] })).get(
          id,
        )!,
        balance: await getBalance(tx, { organizationId: orgId, batchId: id }),
      };
    });

    // Three units, fully tagged — so three rows and no untagged remainder.
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.batchUnit?.label).sort()).toEqual(['T-1', 'T-2', 'T-3']);
    expect(balance.qty.toString()).toBe('5000');
    expect([...byUnit.values()].map((q) => q.toString()).sort()).toEqual(['1700', '2900', '400']);
    expect(byUnit.get(null)).toBeUndefined();

    // 🔴 Value rides along proportionally and the batch's total is exactly what
    // it would have been without units — a unit carries no value of its own, it
    // inherits its batch's weighted average. This is what keeps the level out of
    // valuation entirely.
    expect(balance.value.toString()).toBe('50000');
    expect(batchId).toBeTruthy();
  });

  /**
   * 🔴 PARTIAL TAGGING IS NO LONGER LEGAL (2026-09-02). This test asserted the
   * opposite until then: 3000 tagged out of 5000 posted a 2000 untagged remainder
   * and passed. The rule is now an equality — name every package or name none —
   * so the same payload is refused, and it is refused BESIDE THE WRITE rather
   * than only by the route's schema.
   */
  it('refuses a batch whose units account for only part of it', async () => {
    await expect(
      createBill(
        orgId,
        userId,
        billPayload([
          {
            supplierBatchRef: `JV-${unique()}`,
            quantity: 5000,
            units: [{ label: 'T-1', quantity: 3000 }],
          },
        ]),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('still accepts a batch that names NO units — the level stays optional', async () => {
    const bill = await createBill(
      orgId,
      userId,
      billPayload([{ supplierBatchRef: `JV-${unique()}`, quantity: 5000 }]),
    );

    const byUnit = await runAsTenant(orgId, async (tx) => {
      const ledger = await tx.stockLedgerEntry.findFirst({
        where: { organizationId: orgId, sourceDocType: 'bill', sourceDocId: bill.id },
      });
      return (
        await getBalancesByBatchUnit(tx, { organizationId: orgId, batchIds: [ledger!.batchId] })
      ).get(ledger!.batchId)!;
    });

    // The whole batch is untagged, which is what every org without the level, and
    // every bill posted before it existed, looks like.
    expect(byUnit.get(null)!.toString()).toBe('5000');
  });

  it('refuses a batch whose units hold more than the batch does', async () => {
    await expect(
      createBill(
        orgId,
        userId,
        billPayload([
          {
            supplierBatchRef: `JV-${unique()}`,
            quantity: 1000,
            units: [
              { label: 'T-1', quantity: 700 },
              { label: 'T-2', quantity: 700 },
            ],
          },
        ]),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('leaves a bill with no units posting exactly one row, as it always did', async () => {
    const bill = await createBill(
      orgId,
      userId,
      billPayload([{ supplierBatchRef: `JV-${unique()}`, quantity: 250 }]),
    );

    const rows = await runAsTenant(orgId, (tx) =>
      tx.stockLedgerEntry.findMany({
        where: { organizationId: orgId, sourceDocType: 'bill', sourceDocId: bill.id },
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.batchUnitId).toBeNull();
  });
});

/**
 * Both of these predate the unit level. Neither is caused by it; both get worse
 * under it, which is why they are fixed and pinned in the same commit.
 */
describe('bill — the two defects the unit level would have amplified', () => {
  it('does not post a second time when a bill goes Open → Draft → Open', async () => {
    const bill = await createBill(
      orgId,
      userId,
      billPayload(
        [
          {
            supplierBatchRef: `JV-${unique()}`,
            quantity: 100,
            units: [{ label: 'T-1', quantity: 100 }],
          },
        ],
        'Draft',
      ),
    );

    const lineItems = [
      {
        itemId,
        quantity: 100,
        rate: 10,
        amount: 1000,
        batches: [
          {
            supplierBatchRef: `JV-${unique()}`,
            quantity: 100,
            units: [{ label: 'T-1', quantity: 100 }],
          },
        ],
      },
    ];

    // Draft → Open: this is the posting.
    await updateBill(orgId, bill.id, userId, { status: 'Open', lineItems } as never);
    // …and back, and forward again. `updateBillSchema` is `.partial()`, so this
    // is reachable from the UI.
    await updateBill(orgId, bill.id, userId, { status: 'Draft' } as never);
    await updateBill(orgId, bill.id, userId, { status: 'Open', lineItems } as never);

    const rows = await runAsTenant(orgId, (tx) =>
      tx.stockLedgerEntry.findMany({
        where: { organizationId: orgId, sourceDocType: 'bill', sourceDocId: bill.id },
      }),
    );

    // 🔴 One row, not two. Before the guard this doubled the stock AND its value,
    // and with units it would additionally have tried to create "T-1" twice in
    // one batch — a 409 for a user who did nothing wrong.
    expect(rows).toHaveLength(1);
    const balance = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId: rows[0]!.batchId }),
    );
    expect(balance.qty.toString()).toBe('100');
  });

  it('files each line’s movements under that line, with several lines on one bill', async () => {
    const secondItemId = await runAsTenant(orgId, async (tx) => {
      const item = await tx.item.create({
        data: {
          organizationId: orgId,
          name: 'Dyed Fabric',
          sku: `BILL-UNITS-2-${unique()}`,
          unit: 'Metre',
          stockingUomId: uomId,
          inventoryTracking: 'batch',
          trackInventory: true,
        },
        select: { id: true },
      });
      return item.id;
    });

    const bill = await createBill(orgId, userId, {
      vendorId,
      locationId,
      sourcePoId: null,
      billNumber: `BILL-${unique()}`,
      billDate: new Date(),
      dueDate: null,
      subTotal: 0,
      totalAmount: 0,
      status: 'Draft',
      lineItems: [
        { itemId, quantity: 10, rate: 1, amount: 10 },
        { itemId: secondItemId, quantity: 20, rate: 1, amount: 20 },
      ],
    } as CreateBillPayload);

    await updateBill(orgId, bill.id, userId, {
      status: 'Open',
      lineItems: [
        {
          itemId,
          quantity: 10,
          rate: 1,
          amount: 10,
          batches: [{ supplierBatchRef: `A-${unique()}`, quantity: 10 }],
        },
        {
          itemId: secondItemId,
          quantity: 20,
          rate: 1,
          amount: 20,
          batches: [{ supplierBatchRef: `B-${unique()}`, quantity: 20 }],
        },
      ],
    } as never);

    const rows = await runAsTenant(orgId, (tx) =>
      tx.stockLedgerEntry.findMany({
        where: { organizationId: orgId, sourceDocType: 'bill', sourceDocId: bill.id },
      }),
    );
    const lines = await runAsTenant(orgId, (tx) =>
      tx.billItem.findMany({ where: { billId: bill.id, isDeleted: false } }),
    );
    const lineItemById = new Map(lines.map((line) => [line.id, line.itemId]));

    // 🔴 Every movement must sit under the line for its OWN item. The pairing was
    // by array index against `orderBy: { createdAt: 'asc' }`, and every line of
    // one bill carries the identical `created_at` — Postgres's CURRENT_TIMESTAMP
    // is the transaction's start — so the sort had nothing to order by and the
    // pairing was whatever the planner chose.
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(lineItemById.get(row.sourceDocLineId!)).toBe(row.itemId);
    }
  });
});
