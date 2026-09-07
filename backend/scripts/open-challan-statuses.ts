/**
 * ONE-OFF BACKFILL — challans still carrying a status that no longer exists.
 *
 * Challan closing was removed on 2026-09-07: a challan is `draft`, `issued` or
 * `cancelled`, and nothing derives its way between them any more. Rows written
 * before that carry `partially_received` or `closed`, which now render as their
 * own raw string on screen and match no filter.
 *
 * 🔴 IT WRITES NOTHING WITHOUT `--apply`.
 *
 *     npx tsx scripts/open-challan-statuses.ts
 *     npx tsx scripts/open-challan-statuses.ts --apply
 *
 * Both old values mean the same thing now — the challan went out — so both
 * become `issued`. Nothing else changes: no ledger row, no receipt, no quantity.
 * How much of a challan has come back was never in this column; it is the
 * balance at the processor's location, and that is what every report already
 * reads.
 *
 * Safe to re-run: the second pass matches nothing.
 */
import { prisma, runAsTenant } from '../src/db/prisma.ts';

const APPLY = process.argv.includes('--apply');
const RETIRED = ['partially_received', 'closed'];

const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
console.log(APPLY ? '\n=== APPLYING ===\n' : '\n=== DRY RUN — nothing will be written ===\n');

let total = 0;
for (const org of orgs) {
  const rows = await runAsTenant(org.id, (tx) =>
    tx.jobIssue.findMany({
      where: { organizationId: org.id, status: { in: RETIRED } },
      select: { challanNumber: true, status: true },
      orderBy: { challanNumber: 'asc' },
    }),
  );
  if (rows.length === 0) continue;
  total += rows.length;

  const byStatus = RETIRED.map((s) => `${rows.filter((r) => r.status === s).length} ${s}`).join(
    ', ',
  );
  console.log(`${org.name}: ${rows.length} challan(s) — ${byStatus}`);
  console.log(`   ${rows.map((r) => r.challanNumber).join(', ')}`);

  if (APPLY) {
    const { count } = await runAsTenant(org.id, (tx) =>
      tx.jobIssue.updateMany({
        where: { organizationId: org.id, status: { in: RETIRED } },
        data: { status: 'issued' },
      }),
    );
    console.log(`   ✓ ${count} set to issued`);
  }
}

console.log(
  total === 0
    ? '\nNothing to do — no challan carries a retired status.\n'
    : APPLY
      ? `\nDone — ${total} challan(s).\n`
      : `\n${total} challan(s) would be set to issued. Re-run with --apply.\n`,
);
await prisma.$disconnect();
