import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { deleteTestOrganization, uniqueOrgCode } from '../../../db/testTenant.ts';
import { createBill, updateBill, deleteBill, getBillById } from './bills.service.ts';
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
    // Document rows before packages before batches — each holds a RESTRICT key on
    // the next, so the reverse order fails on the constraint rather than on the
    // data. Same rule the jobwork suites follow.
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

/** The packages a batch still has, in `seq` order — shared by the suites below. */
const liveUnitsOf = (batchId: string) =>
  runAsTenant(orgId, (tx) =>
    tx.batchUnit.findMany({
      where: { organizationId: orgId, batchId, isDeleted: false },
      orderBy: { seq: 'asc' },
      select: { id: true, seq: true, label: true },
    }),
  );

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
        orderBy: { postedAt: 'asc' },
      }),
    );

    /**
     * 🔴 THE INVARIANT IS THE BALANCE, NOT THE ROW COUNT — and that changed with
     * reverse-and-re-post (2026-09-08).
     *
     * This asserted exactly one row while the guard was a flat "post once, ever".
     * That did stop the doubling, but it is also what made a posted bill's stock
     * uncorrectable: the same branch that refused the second posting refused every
     * edit. The third save below now withdraws what the bill holds and re-posts the
     * payload, so the ledger reads receipt → reversal → receipt: three rows telling
     * the true story, netting to the 100 the bill actually claims.
     *
     * The old failure would show here as a total of 200, which is what this
     * really guards.
     *
     * 🔴 SUMMED ACROSS THE BILL'S BATCHES, not read off the first one. This
     * payload names a `supplierBatchRef` but no `batchId` — what a script or an
     * import sends, where the edit form round-trips the id — so the re-post mints
     * a SECOND batch and leaves the first reversed at zero. That orphan is
     * deliberate and matches `cancelJobReceipt`: a batch reference is not unique,
     * so an empty one costs nothing, and the stock is what has to be right.
     */
    expect(rows.map((row) => row.movementType)).toEqual(['receipt', 'reversal', 'receipt']);

    const batchIds = [...new Set(rows.map((row) => row.batchId))];
    const balances = await runAsTenant(orgId, (tx) =>
      Promise.all(batchIds.map((batchId) => getBalance(tx, { organizationId: orgId, batchId }))),
    );
    const total = balances.reduce((sum, balance) => sum + Number(balance.qty), 0);
    const value = balances.reduce((sum, balance) => sum + Number(balance.value), 0);
    expect(total).toBe(100);
    expect(value).toBe(1000);

    // And one live taka holding it — not two "T-1"s, which is the 409 the old
    // comment warned about.
    const live = await runAsTenant(orgId, (tx) =>
      tx.batchUnit.findMany({
        where: { organizationId: orgId, batchId: { in: batchIds }, isDeleted: false },
      }),
    );
    expect(live).toHaveLength(1);
    expect(live[0]!.label).toBe('T-1');
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

/**
 * 🔴 EDITING A POSTED BILL MOVES THE STOCK — the half of `receiveBillBatch` that
 * did not exist until 2026-09-08.
 *
 * Every one of these failed before `reverseBillPostings`: the edit replaced the
 * bill's line rows, returned 200, and left the ledger exactly as it was. The
 * quantity the user removed stayed receivable, its taka stayed in every picker,
 * and the bill's own form went blank because the movements still pointed at the
 * line ids the edit had just soft-deleted.
 */
describe('bill — editing a posted bill re-posts its stock', () => {
  /** Open a bill with the given takas, then return it and its batch id. */
  async function postedBill(units: { label: string; quantity: number }[]) {
    const quantity = units.reduce((sum, unit) => sum + unit.quantity, 0);
    const bill = await createBill(
      orgId,
      userId,
      billPayload([{ supplierBatchRef: `JV-${unique()}`, quantity, units }], 'Open', quantity),
    );
    const batchId = await runAsTenant(orgId, async (tx) => {
      const row = await tx.stockLedgerEntry.findFirst({
        where: { organizationId: orgId, sourceDocType: 'bill', sourceDocId: bill.id },
      });
      return row!.batchId;
    });
    return { bill, batchId, quantity };
  }

  const liveUnits = (batchId: string) =>
    runAsTenant(orgId, (tx) =>
      tx.batchUnit.findMany({
        where: { organizationId: orgId, batchId, isDeleted: false },
        orderBy: { seq: 'asc' },
        select: { id: true, seq: true, label: true },
      }),
    );

  /**
   * 🔴 THE REPORTED CASE, END TO END. Three takas are billed, one is a mistake,
   * and the corrected bill names two — the second of them a single 200 m roll.
   */
  it('removes a taka’s stock and mints the replacement at a fresh seq', async () => {
    const { bill, batchId } = await postedBill([
      { label: 'T-1', quantity: 100 },
      { label: 'T-2', quantity: 80 },
      { label: 'T-3', quantity: 120 },
    ]);

    const before = await liveUnits(batchId);
    expect(before.map((unit) => unit.seq)).toEqual([1, 2, 3]);

    // The form round-trips `batchUnitId` for a taka the user kept — here T-1 —
    // and sends the 200 m roll as a new one.
    await updateBill(orgId, bill.id, userId, {
      status: 'Open',
      lineItems: [
        {
          itemId,
          quantity: 300,
          rate: 10,
          amount: 3000,
          batches: [
            {
              batchId,
              quantity: 300,
              units: [
                { batchUnitId: before[0]!.id, quantity: 100 },
                { label: 'T-4', quantity: 200 },
              ],
            },
          ],
        },
      ],
    } as never);

    const { balance, byUnit } = await runAsTenant(orgId, async (tx) => ({
      balance: await getBalance(tx, { organizationId: orgId, batchId }),
      byUnit: (
        await getBalancesByBatchUnit(tx, { organizationId: orgId, batchIds: [batchId] })
      ).get(batchId)!,
    }));

    // 🔴 300 both before and after — the same total, a different split. The bug
    // this pins left it at 300 in three takas of 100/80/120 with the 200 nowhere.
    expect(balance.qty.toString()).toBe('300');
    expect(balance.value.toString()).toBe('3000');

    const after = await liveUnits(batchId);
    expect(after.map((unit) => unit.label)).toEqual(['T-1', 'T-4']);
    // 🔴 seq 4, not 2. The dropped takas' numbers are retired, never handed on —
    // reusing one would file two physical rolls under a single identity.
    expect(after.map((unit) => unit.seq)).toEqual([1, 4]);
    expect(after[0]!.id).toBe(before[0]!.id); // an untouched taka keeps its row

    expect(byUnit.get(after[0]!.id)!.toString()).toBe('100');
    expect(byUnit.get(after[1]!.id)!.toString()).toBe('200');
    // The two removed takas hold nothing, rather than holding their old quantity.
    for (const gone of before.slice(1)) {
      expect(byUnit.get(gone.id)?.toString() ?? '0').toBe('0');
    }
  });

  /** The reversal nets, so the second and third saves are not double-reversals. */
  it('survives being edited repeatedly without going negative', async () => {
    const { bill, batchId } = await postedBill([{ label: 'T-1', quantity: 100 }]);

    for (const quantity of [60, 250, 40]) {
      await updateBill(orgId, bill.id, userId, {
        status: 'Open',
        lineItems: [
          {
            itemId,
            quantity,
            rate: 10,
            amount: quantity * 10,
            batches: [{ batchId, quantity, units: [{ label: `T-${unique()}`, quantity }] }],
          },
        ],
      } as never);

      const balance = await runAsTenant(orgId, (tx) =>
        getBalance(tx, { organizationId: orgId, batchId }),
      );
      // Each save leaves exactly what it asked for — never the running sum, and
      // never negative from re-reversing rows an earlier save already undid.
      expect(balance.qty.toString()).toBe(String(quantity));
    }

    expect(await liveUnits(batchId)).toHaveLength(1);
  });

  /**
   * 🔴 THE GUARD. A bill whose stock has moved on cannot be quietly withdrawn —
   * the quantity is no longer there to take back.
   */
  it('refuses the edit once the stock has been issued onward', async () => {
    const { bill, batchId } = await postedBill([{ label: 'T-1', quantity: 100 }]);
    const [unit] = await liveUnits(batchId);

    // Somebody else takes it out — the shape of a job issue, without the module.
    await runAsTenant(orgId, (tx) =>
      tx.stockLedgerEntry.create({
        data: {
          organizationId: orgId,
          itemId,
          batchId,
          batchUnitId: unit!.id,
          locationId,
          movementType: 'issue',
          qtyOut: 40,
          valueOut: 400,
          sourceDocType: 'job_issue',
          sourceDocId: null,
        },
      }),
    );

    await expect(
      updateBill(orgId, bill.id, userId, {
        status: 'Open',
        lineItems: [
          {
            itemId,
            quantity: 50,
            rate: 10,
            amount: 500,
            batches: [{ batchId, quantity: 50, units: [{ label: 'T-9', quantity: 50 }] }],
          },
        ],
      } as never),
    ).rejects.toMatchObject({ status: 409 });

    // And nothing was half-done: the transaction rolled back, so the taka is
    // still live and the balance still reflects the issue alone.
    const balance = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId }),
    );
    expect(balance.qty.toString()).toBe('60');
    expect(await liveUnits(batchId)).toHaveLength(1);
  });

  /**
   * 🔴 A PARTIAL UPDATE MUST NOT REVERSE ANYTHING. `updateBillSchema` is
   * `.partial()`, so a note or an attachment arrives with no `lineItems` — and
   * `writtenLines` then falls back to the rows already on the bill, which carry no
   * `batches`. Reversing on that would withdraw the stock and re-post it as one
   * untagged lump, silently destroying every taka on an edit that never mentioned
   * them.
   */
  it('leaves the postings alone when the payload carries no lines', async () => {
    const { bill, batchId } = await postedBill([
      { label: 'T-1', quantity: 100 },
      { label: 'T-2', quantity: 50 },
    ]);

    await updateBill(orgId, bill.id, userId, { paymentTerms: 'Net 30' } as never);

    const rows = await runAsTenant(orgId, (tx) =>
      tx.stockLedgerEntry.findMany({
        where: { organizationId: orgId, sourceDocType: 'bill', sourceDocId: bill.id },
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.movementType === 'receipt')).toBe(true);
    expect(await liveUnits(batchId)).toHaveLength(2);
  });

  /** The readback is what the edit form re-submits, so a reversal must not net
   * into it — half the batch would come back and the next save would halve it. */
  it('reads the corrected quantities back, not the reversed ones', async () => {
    const { bill, batchId } = await postedBill([
      { label: 'T-1', quantity: 100 },
      { label: 'T-2', quantity: 80 },
    ]);

    await updateBill(orgId, bill.id, userId, {
      status: 'Open',
      lineItems: [
        {
          itemId,
          quantity: 70,
          rate: 10,
          amount: 700,
          batches: [{ batchId, quantity: 70, units: [{ label: 'T-5', quantity: 70 }] }],
        },
      ],
    } as never);

    const read = await getBillById(orgId, bill.id);
    const batches = read!.lineItems[0]!.batches!;
    expect(batches).toHaveLength(1);
    expect(batches[0]!.quantity).toBe(70);
    expect(batches[0]!.units.map((unit) => unit.label)).toEqual(['T-5']);
  });

  /**
   * 🔴 A DRAFT HOLDS NO STOCK. Sending a posted bill back to Draft used to leave
   * every receipt row standing, so the ledger said 150 while the document said
   * "not posted yet" — and the next Draft → Open would have posted a second time
   * had the guard not existed.
   */
  it('withdraws the stock when a posted bill goes back to Draft, but keeps the paperwork', async () => {
    const { bill, batchId } = await postedBill([
      { label: 'T-1', quantity: 100 },
      { label: 'T-2', quantity: 50 },
    ]);
    expect(await liveUnits(batchId)).toHaveLength(2);

    await updateBill(orgId, bill.id, userId, { status: 'Draft' } as never);

    const balance = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId }),
    );
    expect(balance.qty.toString()).toBe('0');
    expect(balance.value.toString()).toBe('0');

    /**
     * 🔴 THE STOCK GOES, THE DOCUMENT STAYS — and this assertion is the inverse of
     * what it was before `bill_item_batches` existed (2026-09-08).
     *
     * It used to expect the packages retired, because back then a draft could not
     * hold anything: the batches were derived from the ledger, so a bill with no
     * postings read back empty and a taka with no movements was pure litter.
     *
     * Now the draft still SAYS it received these two takas — that is what a draft
     * is — so its packages and its rows survive. Reopening posts them again from
     * the document rather than asking the user to retype them.
     */
    expect(await liveUnits(batchId)).toHaveLength(2);

    const read = await getBillById(orgId, bill.id);
    expect(read!.lineItems[0]!.batches![0]!.units.map((u) => u.label)).toEqual(['T-1', 'T-2']);
  });

  /**
   * 🔴 A DELETED BILL TAKES ITS STOCK WITH IT. `deleteBill` soft-deleted the row
   * and stopped, so a posted bill's stock stayed issuable from a document that
   * had vanished from every screen — and with the bill gone there was no path
   * left to take it back.
   */
  it('withdraws the stock when a posted bill is deleted', async () => {
    const { bill, batchId } = await postedBill([
      { label: 'T-1', quantity: 100 },
      { label: 'T-2', quantity: 120 },
    ]);

    await deleteBill(orgId, bill.id, userId);

    const balance = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId }),
    );
    expect(balance.qty.toString()).toBe('0');
    expect(await liveUnits(batchId)).toHaveLength(0);

    // The ledger keeps both halves — a movement is never deleted here, only undone.
    const rows = await runAsTenant(orgId, (tx) =>
      tx.stockLedgerEntry.findMany({
        where: { organizationId: orgId, sourceDocType: 'bill', sourceDocId: bill.id },
      }),
    );
    expect(rows.filter((row) => row.movementType === 'receipt')).toHaveLength(2);
    expect(rows.filter((row) => row.movementType === 'reversal')).toHaveLength(2);
  });

  /** The delete inherits the edit's guard, which is the point: stock that has
   * gone onward cannot be spirited away by deleting the document behind it. */
  it('refuses to delete a bill whose stock has been issued onward', async () => {
    const { bill, batchId } = await postedBill([{ label: 'T-1', quantity: 100 }]);
    const [unit] = await liveUnits(batchId);

    await runAsTenant(orgId, (tx) =>
      tx.stockLedgerEntry.create({
        data: {
          organizationId: orgId,
          itemId,
          batchId,
          batchUnitId: unit!.id,
          locationId,
          movementType: 'issue',
          qtyOut: 30,
          valueOut: 300,
          sourceDocType: 'job_issue',
          sourceDocId: null,
        },
      }),
    );

    await expect(deleteBill(orgId, bill.id, userId)).rejects.toMatchObject({ status: 409 });

    // Rolled back whole: the bill is still there to be dealt with properly.
    const still = await getBillById(orgId, bill.id);
    expect(still).not.toBeNull();
    const balance = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId }),
    );
    expect(balance.qty.toString()).toBe('70');
  });
});

/**
 * 🔴 THE DOCUMENT REMEMBERS WHAT IT SAID — `bill_item_batches`, added 2026-09-08.
 *
 * Every test here failed before it existed, and all for one reason: `getBillById`
 * reconstructed a bill's batches by reading `stock_ledger` back. A draft posts
 * nothing, so it read back with nothing — every batch and every taka the user
 * typed was discarded the moment they hit Save.
 *
 * This is the same split `job_issue_lines` has always had, which is exactly why
 * jobwork's drafts worked from day one and bills' could not.
 */
describe('bill — a draft keeps its batches and takas', () => {
  const draftPayload = (status: string, ref: string) =>
    billPayload(
      [
        {
          supplierBatchRef: ref,
          quantity: 300,
          units: [
            { label: 'T-1', quantity: 100 },
            { label: 'T-2', quantity: 200 },
          ],
        },
      ],
      status,
      300,
    );

  it('reads a draft back with everything that was typed into it', async () => {
    const ref = `JV-${unique()}`;
    const bill = await createBill(orgId, userId, draftPayload('Draft', ref));

    const read = await getBillById(orgId, bill.id);
    const batches = read!.lineItems[0]!.batches!;
    expect(batches).toHaveLength(1);
    expect(batches[0]!.supplierBatchRef).toBe(ref);
    expect(batches[0]!.quantity).toBe(300);
    expect(batches[0]!.units.map((u) => u.label)).toEqual(['T-1', 'T-2']);
    expect(batches[0]!.units.map((u) => u.quantity)).toEqual([100, 200]);

    // 🔴 AND IT MOVED NOTHING. A draft is a parking space: the paperwork is
    // complete, the stock has not arrived, and no picker offers these takas.
    const rows = await runAsTenant(orgId, (tx) =>
      tx.stockLedgerEntry.findMany({
        where: { organizationId: orgId, sourceDocType: 'bill', sourceDocId: bill.id },
      }),
    );
    expect(rows).toHaveLength(0);
    const balance = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId: batches[0]!.batchId! }),
    );
    expect(balance.qty.toString()).toBe('0');
  });

  it('posts exactly what the draft said when it is opened', async () => {
    const bill = await createBill(orgId, userId, draftPayload('Draft', `JV-${unique()}`));
    const read = await getBillById(orgId, bill.id);
    const draftBatch = read!.lineItems[0]!.batches![0]!;

    // What the form re-submits: the ids it read back, unchanged.
    await updateBill(orgId, bill.id, userId, {
      status: 'Open',
      lineItems: [
        {
          itemId,
          quantity: 300,
          rate: 10,
          amount: 3000,
          batches: [
            {
              batchId: draftBatch.batchId,
              quantity: 300,
              units: draftBatch.units.map((u) => ({
                batchUnitId: u.batchUnitId,
                quantity: u.quantity,
              })),
            },
          ],
        },
      ],
    } as never);

    const { balance, byUnit } = await runAsTenant(orgId, async (tx) => ({
      balance: await getBalance(tx, { organizationId: orgId, batchId: draftBatch.batchId! }),
      byUnit: (
        await getBalancesByBatchUnit(tx, { organizationId: orgId, batchIds: [draftBatch.batchId!] })
      ).get(draftBatch.batchId!)!,
    }));

    expect(balance.qty.toString()).toBe('300');
    // 🔴 The SAME packages the draft created — not fresh ones. The draft's takas
    // are the real rows, so opening tops them up rather than minting duplicates
    // that would collide on their own tags.
    expect(byUnit.get(draftBatch.units[0]!.batchUnitId)!.toString()).toBe('100');
    expect(byUnit.get(draftBatch.units[1]!.batchUnitId)!.toString()).toBe('200');
    expect(await liveUnitsOf(draftBatch.batchId!)).toHaveLength(2);
  });

  it('keeps a draft editable, and retires a taka removed from one', async () => {
    const bill = await createBill(orgId, userId, draftPayload('Draft', `JV-${unique()}`));
    const first = await getBillById(orgId, bill.id);
    const batch = first!.lineItems[0]!.batches![0]!;
    const keep = batch.units[0]!;

    // Drop T-2, keep T-1, add a new one.
    await updateBill(orgId, bill.id, userId, {
      status: 'Draft',
      lineItems: [
        {
          itemId,
          quantity: 250,
          rate: 10,
          amount: 2500,
          batches: [
            {
              batchId: batch.batchId,
              quantity: 250,
              units: [
                { batchUnitId: keep.batchUnitId, quantity: 100 },
                { label: 'T-9', quantity: 150 },
              ],
            },
          ],
        },
      ],
    } as never);

    const read = await getBillById(orgId, bill.id);
    const after = read!.lineItems[0]!.batches!;
    expect(after).toHaveLength(1);
    expect(after[0]!.quantity).toBe(250);
    expect(after[0]!.units.map((u) => u.label)).toEqual(['T-1', 'T-9']);

    // 🔴 T-2 is gone from the batch too, not just from the paperwork. Nothing
    // reverses it — a draft moved no stock — so this is the cleanup that only
    // `retireBillUnits` does, and without it the tag stays reserved for ever.
    const live = await liveUnitsOf(batch.batchId!);
    expect(live.map((u) => u.label)).toEqual(['T-1', 'T-9']);
    // Its `seq` is retired with it: T-9 is #3, never #2.
    expect(live.map((u) => u.seq)).toEqual([1, 3]);

    // Still a draft, so still nothing on the books.
    const rows = await runAsTenant(orgId, (tx) =>
      tx.stockLedgerEntry.findMany({
        where: { organizationId: orgId, sourceDocType: 'bill', sourceDocId: bill.id },
      }),
    );
    expect(rows).toHaveLength(0);
  });

  it('does not invent a batch for a draft whose lines name none', async () => {
    // The unnamed fallback exists so an OPEN bill still moves stock when the user
    // skipped the batch dialog. On a draft it would have to invent a reference
    // `createBatch` refuses to do without — and inventing one is wrong anyway,
    // because the user has not chosen the batch yet.
    const bill = await createBill(orgId, userId, {
      ...billPayload(undefined, 'Draft', 40),
      lineItems: [{ itemId, quantity: 40, rate: 10, amount: 400 }],
    } as never);

    const read = await getBillById(orgId, bill.id);
    expect(read!.lineItems[0]!.batches).toBeUndefined();
  });

  it('a deleted bill stops claiming its batches', async () => {
    const bill = await createBill(orgId, userId, draftPayload('Draft', `JV-${unique()}`));
    const read = await getBillById(orgId, bill.id);
    const batchId = read!.lineItems[0]!.batches![0]!.batchId!;

    await deleteBill(orgId, bill.id, userId);

    expect(await getBillById(orgId, bill.id)).toBeNull();
    const rows = await runAsTenant(orgId, (tx) =>
      tx.billItemBatch.count({ where: { organizationId: orgId, isDeleted: false, batchId } }),
    );
    expect(rows).toBe(0);
    // And its packages go with it — nothing else ever moved them.
    expect(await liveUnitsOf(batchId)).toHaveLength(0);
  });
});
