/**
 * FIFO CUT-OVER (docs/FIFO_COSTING_PLAN.md D4, phase 5) — cost layers for the stock
 * that was already on the books when FIFO arrived.
 *
 * Run it ONCE per database, right after `20260918150000_fifo_cost_layers` is
 * applied and before anyone posts again. Until it runs, every outward posting of
 * pre-existing stock is refused ("Only 0 … is on the books"), because the engine
 * costs outflows from layers and there are none.
 *
 * 🔴 IT WRITES NOTHING WITHOUT `--apply`.
 *
 *     npx tsx scripts/fifo-cutover.ts                 # every organization, dry run
 *     npx tsx scripts/fifo-cutover.ts --org <uuid>    # one organization
 *     npx tsx scripts/fifo-cutover.ts --apply
 *
 * WHAT IT BUILDS
 *
 * One LEGACY layer per (batch, location) of own stock with a positive balance on
 * the accounting axis — its current quantity and value, `in_date` = the batch's
 * first inward `posted_at`. History is not replayed and no posted value changes.
 * Legacy layers carry no challan tag, so at a processor the jobwork scopes accept
 * them by batch (see `is_legacy` in inventory.prisma).
 *
 * WHAT MAKES IT STOP
 *
 *   · A NEGATIVE balance on any (batch, location) — the plan's precondition. Those
 *     are corrected by hand first; a layer cannot hold less than nothing.
 *   · Value with no quantity behind it — no layer can carry it, so the invariant
 *     would never tie.
 *
 * Safe to re-run: a (item, location) that already has layers is left alone and
 * only checked against the invariant, so a second run builds nothing twice.
 */
import { Prisma } from '../generated/prisma/client.ts';
import { prisma, runAsTenant } from '../src/db/prisma.ts';
import {
  checkLayerInvariant,
  createLayers,
  planLegacyLayers,
} from '../src/modules/inventory/stock-ledger/costLayers.ts';

const APPLY = process.argv.includes('--apply');
const orgArg = process.argv.indexOf('--org');
const ONLY_ORG = orgArg >= 0 ? process.argv[orgArg + 1] : undefined;
const ZERO = new Prisma.Decimal(0);

console.log(APPLY ? '\n=== APPLYING ===\n' : '\n=== DRY RUN — nothing will be written ===\n');

const orgs = await prisma.organization.findMany({
  where: ONLY_ORG ? { id: ONLY_ORG } : {},
  select: { id: true, name: true },
  orderBy: { name: 'asc' },
});

let blocked = false;
let built = 0;

for (const org of orgs) {
  const result = await runAsTenant(
    org.id,
    async (tx) => {
      const plan = await planLegacyLayers(tx, org.id);
      const clean = plan.problems.length === 0;
      if (clean && APPLY) await createLayers(tx, org.id, plan.layers);
      const mismatches = clean && APPLY ? await checkLayerInvariant(tx, org.id) : [];
      return { ...plan, mismatches };
    },
    { maxWait: 15_000, timeout: 300_000 },
  );

  if (result.problems.length > 0) {
    blocked = true;
    console.log(`✗ ${org.name} — ${result.problems.length} position(s) need correcting first:`);
    for (const p of result.problems) {
      console.log(
        `    item ${p.itemId}  batch ${p.batchId}  location ${p.locationId}  ` +
          `qty ${p.qty.toString()}  value ${p.value.toString()}`,
      );
    }
    continue;
  }

  const value = result.layers.reduce((sum, layer) => sum.plus(layer.value), ZERO);
  console.log(
    `${APPLY ? '✓' : '·'} ${org.name} — ${result.layers.length} legacy layer(s), value ${value.toString()}` +
      (result.alreadyCovered
        ? `; ${result.alreadyCovered} item-location(s) already had layers`
        : ''),
  );
  for (const mismatch of result.mismatches) {
    console.log(
      `    ⚠ invariant: item ${mismatch.itemId} at ${mismatch.locationId} — ledger ` +
        `${mismatch.ledgerQty.toString()} / ${mismatch.ledgerValue.toString()}, layers ` +
        `${mismatch.layerQty.toString()} / ${mismatch.layerValue.toString()}`,
    );
  }
  built += result.layers.length;
}

console.log(
  blocked
    ? '\nStopped: correct the positions above by hand, then run again. Nothing was written for those organizations.'
    : `\n${APPLY ? 'Built' : 'Would build'} ${built} legacy layer(s).`,
);
await prisma.$disconnect();
process.exit(blocked ? 1 : 0);
