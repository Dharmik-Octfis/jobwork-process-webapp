import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma } from '../../../../generated/prisma/client.ts';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { ApiError } from '../../../lib/apiError.ts';
import {
  createBatch,
  getAvailableBatches,
  getBalance,
  postMovement,
} from './stockLedger.service.ts';

/**
 * The ledger is the one thing in this domain that cannot be repaired after the
 * fact: a wrong number can be recomputed from history, a wrong history cannot be
 * recomputed from anything. So the four properties everything else assumes are
 * pinned here — post→balance, reversal→zero, ownership isolation, and value
 * being derived rather than stored.
 *
 * 🔴 Every row this file touches is created by this file and hard-deleted
 * afterwards. Suites run against the dev database IN PARALLEL, so a test that
 * mutated an org, item or location it merely *found* would break whatever another
 * suite was doing with it at that moment. Nothing here reads pre-existing data.
 *
 * Deletes are hard (`deleteMany`), not the soft delete the app uses — this is
 * cleanup of test scaffolding, not a user action, and leaving soft-deleted rows
 * behind would slowly fill a shared database with debris.
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let itemId: string;
let uomId: string;
let godownId: string;
let processorId: string;
let customerId: string;

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: {
      name: `ledger-test-${unique()}`,
      // 10 digits, like the real generator. Unique per run so parallel suites
      // never collide on it.
      orgCode: String(Date.now()).slice(-10),
    },
    select: { id: true },
  });
  orgId = org.id;

  // Everything below is RLS-gated, so it has to be written inside a tenant
  // context — exactly like the app writes it. Doing this through raw SQL as the
  // owner would also prove nothing about whether the policies allow the app's
  // own inserts.
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
        sku: `LEDGER-${unique()}`,
        unit: 'Metre',
        stockingUomId: uomId,
        inventoryTracking: 'batch',
      },
      select: { id: true },
    });
    itemId = item.id;

    const godown = await tx.location.create({
      data: { organizationId: orgId, name: 'Main Godown', type: 'godown' },
      select: { id: true },
    });
    godownId = godown.id;

    // Goods at a processor are OUR stock at THEIR location (§5.4) — one axis, so
    // a processor is just another location.
    const processor = await tx.location.create({
      data: { organizationId: orgId, name: 'Sunrise Dyeing', type: 'processor' },
      select: { id: true },
    });
    processorId = processor.id;

    const customer = await tx.customer.create({
      data: {
        organizationId: orgId,
        contactName: 'Principal Mills',
        contactNumber: `CUS-${unique()}`,
      },
      select: { id: true },
    });
    customerId = customer.id;
  });
});

afterAll(async () => {
  // Bottom-up. `stock_ledger` holds RESTRICT foreign keys to items, batches and
  // locations, so letting the organization cascade would hit those constraints
  // in whatever order Postgres chose.
  await runAsTenant(orgId, async (tx) => {
    await tx.stockLedgerEntry.deleteMany({ where: { organizationId: orgId } });
    await tx.batch.deleteMany({ where: { organizationId: orgId } });
    await tx.item.deleteMany({ where: { organizationId: orgId } });
    await tx.location.deleteMany({ where: { organizationId: orgId } });
    await tx.customer.deleteMany({ where: { organizationId: orgId } });
    await tx.unitOfMeasurement.deleteMany({ where: { organizationId: orgId } });
    await tx.numberSequence.deleteMany({ where: { organizationId: orgId } });
  });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

/** A fresh own-stock batch with `qty` already received into the godown. */
async function batchWithStock(qty: number, valuePerUnit = 0) {
  return runAsTenant(orgId, async (tx) => {
    const batch = await createBatch(tx, {
      organizationId: orgId,
      itemId,
      sourceDocType: 'test',
    });
    await postMovement(tx, {
      organizationId: orgId,
      batchId: batch.id,
      locationId: godownId,
      movementType: 'receipt',
      qtyIn: qty,
      valueIn: qty * valuePerUnit,
      sourceDocType: 'test',
    });
    return batch;
  });
}

describe('stock ledger — posting and balances', () => {
  it('a posted movement is the balance', async () => {
    const batch = await batchWithStock(5000);

    const balance = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId: batch.id }),
    );

    expect(balance.qty.toString()).toBe('5000');
  });

  it('an issue moves stock between locations without changing the total', async () => {
    const batch = await batchWithStock(1000);

    await runAsTenant(orgId, async (tx) => {
      // The pair that IS an issue: out of the godown, in at the processor.
      await postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        locationId: godownId,
        movementType: 'issue',
        qtyOut: 400,
        sourceDocType: 'job_issue',
      });
      await postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        locationId: processorId,
        movementType: 'transfer_in',
        qtyIn: 400,
        sourceDocType: 'job_issue',
      });
    });

    const [atGodown, atProcessor, everywhere] = await runAsTenant(orgId, async (tx) => [
      await getBalance(tx, { organizationId: orgId, batchId: batch.id, locationId: godownId }),
      await getBalance(tx, { organizationId: orgId, batchId: batch.id, locationId: processorId }),
      await getBalance(tx, { organizationId: orgId, batchId: batch.id }),
    ]);

    expect(atGodown.qty.toString()).toBe('600');
    expect(atProcessor.qty.toString()).toBe('400');
    // Nothing was created or destroyed — it only moved.
    expect(everywhere.qty.toString()).toBe('1000');
  });

  it('a reversal takes the balance back to zero, and the history survives', async () => {
    const batch = await batchWithStock(250);

    await runAsTenant(orgId, (tx) =>
      postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        locationId: godownId,
        movementType: 'reversal',
        qtyOut: 250,
        sourceDocType: 'test',
        remarks: 'entered against the wrong batch',
      }),
    );

    const { balance, rows } = await runAsTenant(orgId, async (tx) => ({
      balance: await getBalance(tx, { organizationId: orgId, batchId: batch.id }),
      rows: await tx.stockLedgerEntry.count({
        where: { organizationId: orgId, batchId: batch.id },
      }),
    }));

    expect(balance.qty.toString()).toBe('0');
    // The whole point of a reversing entry: the balance is corrected and BOTH
    // rows are still there. An edit or a delete would show 1 here.
    expect(rows).toBe(2);
  });

  it('refuses a movement that is neither an in nor an out, or is both', async () => {
    const batch = await batchWithStock(10);

    await expect(
      runAsTenant(orgId, (tx) =>
        postMovement(tx, {
          organizationId: orgId,
          batchId: batch.id,
          locationId: godownId,
          movementType: 'adjustment',
          sourceDocType: 'test',
        }),
      ),
    ).rejects.toBeInstanceOf(ApiError);

    await expect(
      runAsTenant(orgId, (tx) =>
        postMovement(tx, {
          organizationId: orgId,
          batchId: batch.id,
          locationId: godownId,
          movementType: 'adjustment',
          qtyIn: 5,
          qtyOut: 5,
          sourceDocType: 'test',
        }),
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('stock ledger — value is derived, never stored', () => {
  it('value accumulates and drains with quantity', async () => {
    const batch = await batchWithStock(100, 12.5); // 1,250.00 in

    await runAsTenant(orgId, (tx) =>
      postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        locationId: godownId,
        movementType: 'consume',
        qtyOut: 40,
        valueOut: 500,
        sourceDocType: 'test',
      }),
    );

    const balance = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId: batch.id }),
    );

    expect(balance.qty.toString()).toBe('60');
    // 1250 − 500. There is no `batches.value` column to disagree with this: the batch's
    // value IS this query (plan §3, decision 1).
    expect(balance.value.equals(new Prisma.Decimal(750))).toBe(true);
  });
});

describe('stock ledger — ownership isolation', () => {
  it('customer-owned stock counts in quantity and never in valuation', async () => {
    const batch = await runAsTenant(orgId, async (tx) => {
      const created = await createBatch(tx, {
        organizationId: orgId,
        itemId,
        ownership: 'customer',
        ownerPartyId: customerId,
        sourceDocType: 'test',
      });
      await postMovement(tx, {
        organizationId: orgId,
        batchId: created.id,
        locationId: godownId,
        movementType: 'receipt',
        qtyIn: 800,
        // The caller asks for a value; the service refuses it because the BATCH is
        // customer-owned. The rule lives in one place, not in every module.
        valueIn: 9999,
        sourceDocType: 'test',
      });
      return created;
    });

    const balance = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId: batch.id }),
    );

    expect(balance.qty.toString()).toBe('800');
    expect(balance.value.toString()).toBe('0');
  });

  it('an ownership-filtered balance sees only that ownership', async () => {
    const own = await batchWithStock(70);
    const theirs = await runAsTenant(orgId, async (tx) => {
      const created = await createBatch(tx, {
        organizationId: orgId,
        itemId,
        ownership: 'customer',
        ownerPartyId: customerId,
        sourceDocType: 'test',
      });
      await postMovement(tx, {
        organizationId: orgId,
        batchId: created.id,
        locationId: godownId,
        movementType: 'receipt',
        qtyIn: 30,
        sourceDocType: 'test',
      });
      return created;
    });

    const [ownOnly, customerOnly] = await runAsTenant(orgId, async (tx) => [
      await getBalance(tx, { organizationId: orgId, batchId: own.id, ownership: 'own' }),
      await getBalance(tx, { organizationId: orgId, batchId: own.id, ownership: 'customer' }),
    ]);

    expect(ownOnly.qty.toString()).toBe('70');
    // The same batch, asked about as if it were the customer's: nothing.
    expect(customerOnly.qty.toString()).toBe('0');

    const theirBalance = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId: theirs.id, ownership: 'customer' }),
    );
    expect(theirBalance.qty.toString()).toBe('30');
  });

  it('rejects the two ownership combinations that have no meaning', async () => {
    await expect(
      runAsTenant(orgId, (tx) =>
        createBatch(tx, {
          organizationId: orgId,
          itemId,
          ownership: 'customer',
          sourceDocType: 'test',
        }),
      ),
    ).rejects.toBeInstanceOf(ApiError);

    await expect(
      runAsTenant(orgId, (tx) =>
        createBatch(tx, {
          organizationId: orgId,
          itemId,
          ownership: 'own',
          ownerPartyId: customerId,
          sourceDocType: 'test',
        }),
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('stock ledger — the picker reads the ledger, not the batches table', () => {
  it('drops a batch once its balance at that location reaches zero', async () => {
    const batch = await batchWithStock(300);

    const before = await runAsTenant(orgId, (tx) =>
      getAvailableBatches(tx, {
        organizationId: orgId,
        itemId,
        locationId: godownId,
        ownership: 'own',
      }),
    );
    expect(before.map((l) => l.batchId)).toContain(batch.id);

    await runAsTenant(orgId, (tx) =>
      postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        locationId: godownId,
        movementType: 'issue',
        qtyOut: 300,
        sourceDocType: 'job_issue',
      }),
    );

    const after = await runAsTenant(orgId, (tx) =>
      getAvailableBatches(tx, {
        organizationId: orgId,
        itemId,
        locationId: godownId,
        ownership: 'own',
      }),
    );
    // The batch ROW is still there and always will be — but there is none of it
    // here, so it must not be offered. This is the bug the ledger prevents.
    expect(after.map((l) => l.batchId)).not.toContain(batch.id);
  });

  it('never mixes our stock and a customer’s in one picker', async () => {
    const theirs = await runAsTenant(orgId, async (tx) => {
      const created = await createBatch(tx, {
        organizationId: orgId,
        itemId,
        ownership: 'customer',
        ownerPartyId: customerId,
        sourceDocType: 'test',
      });
      await postMovement(tx, {
        organizationId: orgId,
        batchId: created.id,
        locationId: godownId,
        movementType: 'receipt',
        qtyIn: 55,
        sourceDocType: 'test',
      });
      return created;
    });

    const ours = await runAsTenant(orgId, (tx) =>
      getAvailableBatches(tx, {
        organizationId: orgId,
        itemId,
        locationId: godownId,
        ownership: 'own',
      }),
    );

    expect(ours.map((l) => l.batchId)).not.toContain(theirs.id);
  });
});

describe('batches', () => {
  it('allocates batch numbers from the org sequence', async () => {
    const [first, second] = await runAsTenant(orgId, async (tx) => [
      await createBatch(tx, { organizationId: orgId, itemId, sourceDocType: 'test' }),
      await createBatch(tx, { organizationId: orgId, itemId, sourceDocType: 'test' }),
    ]);

    expect(first.batchNumber).toMatch(/^BATCH-\d{5}$/);
    expect(second.batchNumber).not.toBe(first.batchNumber);
  });

  it('accepts a manual batch number — the supplier’s tag wins when it is given', async () => {
    const manual = `SUPPLIER-${unique()}`;
    const batch = await runAsTenant(orgId, (tx) =>
      createBatch(tx, {
        organizationId: orgId,
        itemId,
        batchNumber: manual,
        supplierBatchRef: 'heat 44821',
        sourceDocType: 'test',
      }),
    );

    expect(batch.batchNumber).toBe(manual);
    expect(batch.supplierBatchRef).toBe('heat 44821');
  });

  /**
   * A soft-deleted batch keeps occupying its number — the unique index is a full
   * one on purpose (Prisma cannot express `WHERE is_deleted = false`, so a
   * partial index would read as permanent drift). These three pin the recycling
   * that stands in for it, including the two cases where it must NOT happen.
   */
  it('re-uses the row a deleted batch left behind when the number is typed again', async () => {
    const number = `TAG-${unique()}`;
    const first = await runAsTenant(orgId, (tx) =>
      createBatch(tx, {
        organizationId: orgId,
        itemId,
        batchNumber: number,
        supplierBatchRef: 'first entry',
        sourceDocType: 'test',
      }),
    );
    await runAsTenant(orgId, (tx) =>
      tx.batch.updateMany({
        where: { id: first.id, organizationId: orgId },
        data: { isDeleted: true },
      }),
    );

    const second = await runAsTenant(orgId, (tx) =>
      createBatch(tx, {
        organizationId: orgId,
        itemId,
        batchNumber: number,
        supplierBatchRef: 'second entry',
        sourceDocType: 'test',
      }),
    );

    // The same row, taken over — the number is on a physical tag, so freeing it
    // is the alternative to refusing it forever.
    expect(second.id).toBe(first.id);
    expect(second.isDeleted).toBe(false);
    expect(second.supplierBatchRef).toBe('second entry');
  });

  it('refuses to re-use a deleted batch that already moved stock', async () => {
    const number = `TAG-${unique()}`;
    const batch = await runAsTenant(orgId, async (tx) => {
      const created = await createBatch(tx, {
        organizationId: orgId,
        itemId,
        batchNumber: number,
        sourceDocType: 'test',
      });
      await postMovement(tx, {
        organizationId: orgId,
        batchId: created.id,
        locationId: godownId,
        movementType: 'receipt',
        qtyIn: 500,
        sourceDocType: 'test',
      });
      return created;
    });
    await runAsTenant(orgId, (tx) =>
      tx.batch.updateMany({
        where: { id: batch.id, organizationId: orgId },
        data: { isDeleted: true },
      }),
    );

    await expect(
      runAsTenant(orgId, (tx) =>
        createBatch(tx, {
          organizationId: orgId,
          itemId,
          batchNumber: number,
          sourceDocType: 'test',
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });

    // 🔴 The reason. `getBalance` sums by batchId and a ledger row is never
    // deleted, so recycling this row would have handed the new batch 500 MTR it
    // never received.
    const balance = await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, batchId: batch.id }),
    );
    expect(balance.qty.toString()).toBe('500');
  });

  it('never recycles for an allocated number, only for a typed one', async () => {
    // Plant a soft-deleted batch on exactly the number the sequence will hand out
    // next — a user typed it before the sequence caught up.
    const probe = await runAsTenant(orgId, (tx) =>
      createBatch(tx, { organizationId: orgId, itemId, sourceDocType: 'test' }),
    );
    // Split on the separator rather than slicing a fixed width — the prefix is
    // per-org data (`number_sequences.prefix`), so its length is not a constant.
    const [prefix, digits] = probe.batchNumber.split('-');
    const nextNumber = `${prefix}-${String(Number(digits) + 1).padStart(digits!.length, '0')}`;

    const planted = await runAsTenant(orgId, (tx) =>
      createBatch(tx, {
        organizationId: orgId,
        itemId,
        batchNumber: nextNumber,
        sourceDocType: 'test',
      }),
    );
    await runAsTenant(orgId, (tx) =>
      tx.batch.updateMany({
        where: { id: planted.id, organizationId: orgId },
        data: { isDeleted: true },
      }),
    );

    // Adopting an unrelated row here would be a silent data bug, not a
    // convenience — nobody asked for that number.
    await expect(
      runAsTenant(orgId, (tx) =>
        createBatch(tx, { organizationId: orgId, itemId, sourceDocType: 'test' }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
