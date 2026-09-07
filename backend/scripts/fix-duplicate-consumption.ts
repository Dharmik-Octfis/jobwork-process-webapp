/**
 * ONE-OFF CORRECTION — the negative balances at Global Inc.
 *
 * On 2026-08-07 JR-00001 posted its receipt lines with `job_issue_line_id` NULL,
 * because the write path did not yet derive them from the allocation (fixed the
 * same day in 9f77749). `closedQtyByIssueLine` groups by that column and drops
 * the null group, so JR-00001 closed nothing on paper. Two weeks later JR-00002
 * saw the same challan lines as fully outstanding and consumed the same four
 * batches a second time.
 *
 * The result is four positions at Global Inc that went below zero, each with the
 * same shape: one `transfer_in` from the challan, one legitimate `consume` by
 * JR-00001, and one duplicate `consume` by JR-00002.
 *
 * 🔴 IT WRITES NOTHING WITHOUT `--apply`.
 *
 *     npx tsx scripts/fix-duplicate-consumption.ts
 *     npx tsx scripts/fix-duplicate-consumption.ts --apply
 *
 * WHAT IT POSTS, AND WHY IT IS QUANTITY ONLY
 *
 * One `adjustment` in per position, for exactly what the duplicate row took out.
 * Not "whatever makes the balance zero": the location also holds material that is
 * genuinely there (2 of swater, 30 of hoodie, from later challans), and a blanket
 * levelling would swallow it. Reversing the specific duplicate leaves those
 * standing.
 *
 * Every row involved carries VALUE 0 — the duplicate consume priced itself
 * against a position JR-00001 had already emptied, so it removed no value. That
 * is why this restores quantity alone: there is no value to give back, and adding
 * any would create an asset out of a clerical fault.
 *
 * 🔴 It is a WRITE-ON, not a repair. The material really was consumed once; what
 * never happened is the second consumption. The output JR-00002 produced from it
 * is still on the books and is not touched — unwinding that would mean cancelling
 * a month-old receipt whose goods have since moved on. The `remarks` on every row
 * says so, because a quantity that appears from nowhere needs to explain itself.
 *
 * Safe to re-run: it only posts against positions that are still negative.
 */
import { Prisma } from '../generated/prisma/client.ts';
import { prisma, runAsTenant } from '../src/db/prisma.ts';
import { postMovement } from '../src/modules/inventory/stock-ledger/stockLedger.service.ts';
import { runAsDocument } from '../src/modules/jobwork/jobwork.types.ts';

const APPLY = process.argv.includes('--apply');
const ZERO = new Prisma.Decimal(0);
const REASON =
  'Write-on: consumed twice by JR-00002 against challan lines JR-00001 had already ' +
  'accounted for (its receipt lines recorded no challan line). Corrected 2026-09-07.';

const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
console.log(APPLY ? '\n=== APPLYING ===\n' : '\n=== DRY RUN — nothing will be written ===\n');

let posted = 0;
for (const org of orgs) {
  const negatives = await runAsTenant(org.id, async (tx) => {
    const grouped = await tx.stockLedgerEntry.groupBy({
      by: ['batchId', 'locationId', 'itemId'],
      where: { organizationId: org.id },
      _sum: { qtyIn: true, qtyOut: true, valueIn: true, valueOut: true },
    });
    const rows = [];
    for (const g of grouped) {
      const qty = (g._sum.qtyIn ?? ZERO).minus(g._sum.qtyOut ?? ZERO);
      if (qty.greaterThanOrEqualTo(0)) continue;
      const value = (g._sum.valueIn ?? ZERO).minus(g._sum.valueOut ?? ZERO);
      const [batch, location, item] = await Promise.all([
        tx.batch.findUnique({
          where: { id: g.batchId },
          select: { supplierBatchRef: true, isDeleted: true },
        }),
        tx.location.findUnique({ where: { id: g.locationId }, select: { name: true } }),
        tx.item.findUnique({ where: { id: g.itemId }, select: { name: true } }),
      ]);
      rows.push({
        batchId: g.batchId,
        locationId: g.locationId,
        shortBy: qty.negated(),
        value,
        label: `${item?.name ?? '?'} ${batch?.supplierBatchRef ? `"${batch.supplierBatchRef}"` : `batch ${g.batchId.slice(0, 8)}`} at ${location?.name}`,
        batchDeleted: batch?.isDeleted ?? false,
      });
    }
    return rows;
  });
  if (negatives.length === 0) continue;

  console.log(`### ${org.name}`);
  for (const row of negatives) {
    if (row.batchDeleted) {
      console.log(`   SKIPPED ${row.label} — its batch is deleted, nothing can post against it`);
      continue;
    }
    /* 🔴 Value must already be zero. If a position went negative in VALUE too,
       restoring quantity alone would leave it priced at nothing, and restoring
       value would invent an asset — a decision this script must not take on its
       own. */
    if (!row.value.isZero()) {
      console.log(
        `   SKIPPED ${row.label} — short by ${row.shortBy} AND carries value ${row.value}; needs a decision, not a script`,
      );
      continue;
    }

    console.log(`   ${row.label}: short by ${row.shortBy} → adjustment in, value 0`);
    if (!APPLY) continue;

    await runAsDocument(org.id, (tx) =>
      postMovement(tx, {
        organizationId: org.id,
        batchId: row.batchId,
        locationId: row.locationId,
        movementType: 'adjustment',
        qtyIn: row.shortBy,
        valueIn: 0,
        sourceDocType: 'correction',
        remarks: REASON,
        postedAt: new Date(),
      }),
    );
    posted += 1;
    console.log(`      ✓ posted`);
  }
}

console.log(
  APPLY
    ? `\nDone — ${posted} adjustment(s).\n`
    : '\nNothing was written. Re-run with --apply to carry this out.\n',
);
await prisma.$disconnect();
