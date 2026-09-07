/**
 * ONE-OFF CORRECTION — records pointing at a jobworker's location.
 *
 * Companion to `fix-receipts-into-processor.ts`, same defect from the other end.
 * While the location pickers were unfiltered, three opening-stock declarations
 * and three bills were saved against a `processor` location: places we do not
 * hold. The pickers now offer our own locations only (2026-09-07), which is what
 * surfaced these — the filter did not break them, it revealed them.
 *
 * 🔴 IT WRITES NOTHING WITHOUT `--apply`. Run it once to read the plan.
 *
 *     npx tsx scripts/fix-records-at-processor-locations.ts
 *     npx tsx scripts/fix-records-at-processor-locations.ts --apply
 *
 * TWO MECHANISMS, because the two kinds of record are corrected differently:
 *
 *   OPENING STOCK  Goes back through `itemsService.saveOpeningStock` — the app's
 *                  own path, exactly what changing the dropdown and pressing Save
 *                  does. A position is keyed by (batch, unit, LOCATION), so the
 *                  declaration at the processor is reversed and re-declared at
 *                  our godown by the same delta engine the screen uses. The whole
 *                  item's rows are sent because an omitted row reads as deleted;
 *                  rows the screen itself drops (no declared quantity) are
 *                  dropped here too, or saving would declare stock nobody typed.
 *
 *   BILLS          A bill posts its receipt rows ONCE, on draft → open
 *                  (`bills.service.ts` guards it with `alreadyPosted`), so moving
 *                  `location_id` afterwards does not move the stock. Where any of
 *                  the bill's own stock is still standing at the wrong place it
 *                  is moved with a paired ledger entry; the pointer is corrected
 *                  either way, and on a DRAFT that also stops it posting to the
 *                  wrong location when somebody opens it.
 *
 * Every ledger write here is append-only. Nothing edits or deletes a posted row:
 * the ledger cannot say "this never happened", only "the opposite happened after".
 */
import { prisma, runAsTenant } from '../src/db/prisma.ts';
import {
  getBalancesByBatch,
  postMovement,
} from '../src/modules/inventory/stock-ledger/stockLedger.service.ts';
import { isExternalLocation, runAsDocument } from '../src/modules/jobwork/jobwork.types.ts';
import { itemsService } from '../src/modules/items/items.service.ts';

const APPLY = process.argv.includes('--apply');
const REASON = 'Recorded against a processor location we do not hold — corrected 2026-09-07.';

const TECHNO = 'a02a9057-83c2-40b8-9adc-2e90057e19be';
const PRASHANT = '99ad5fe2-b1c4-482a-b596-d56cef5b49d7';

/** Opening stock declared at somebody else's premises. Targeted by item NAME
 * plus the location it was declared at, so a second declaration elsewhere on the
 * same item is left alone. */
const OPENING = [
  { orgId: TECHNO, item: 'swater', at: 'Global Inc' },
  { orgId: TECHNO, item: 'Saree', at: 'Acme Corp' },
  { orgId: TECHNO, item: 'keyboard', at: 'Global Inc' },
];

/** Bills whose receiving location is a processor's. */
const BILLS = [
  { orgId: TECHNO, number: 'test-003' },
  { orgId: PRASHANT, number: '123' },
  { orgId: PRASHANT, number: '12345' },
];

const say = (line: string) => console.log(line);
const num = (v: unknown) => Number(v ?? 0);

/** Where corrected stock belongs: the org's primary own location, else its first.
 * Named in the output so a wrong guess is visible and fixable on screen — both
 * bills and opening stock are editable, now that the picker offers ours. */
async function homeLocation(orgId: string) {
  return runAsTenant(orgId, async (tx) => {
    const locs = await tx.location.findMany({
      where: { organizationId: orgId, isDeleted: false },
      select: { id: true, name: true, type: true, isPrimary: true },
      orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    });
    return locs.find((l) => !isExternalLocation(l.type)) ?? null;
  });
}

/** Every batch of one item, by location — the before/after picture. */
async function balancesOf(orgId: string, itemId: string) {
  return runAsTenant(orgId, async (tx) => {
    const rows = await tx.stockLedgerEntry.groupBy({
      by: ['batchId', 'locationId'],
      where: { organizationId: orgId, itemId },
      _sum: { qtyIn: true, qtyOut: true },
    });
    return new Map(
      rows.map((r) => [`${r.batchId}@${r.locationId}`, num(r._sum.qtyIn) - num(r._sum.qtyOut)]),
    );
  });
}

async function main() {
  say(APPLY ? '\n=== APPLYING ===\n' : '\n=== DRY RUN — nothing will be written ===\n');

  // ------------------------------------------------------------------ OPENING STOCK
  for (const target of OPENING) {
    const home = await homeLocation(target.orgId);
    if (!home) {
      say(`OPENING ${target.item} — SKIPPED: this org has no location of its own`);
      continue;
    }

    const { item, wrongLocation } = await runAsTenant(target.orgId, async (tx) => {
      const found = await tx.item.findFirst({
        where: { organizationId: target.orgId, name: target.item, isDeleted: false },
        select: { id: true, name: true },
      });
      const loc = await tx.location.findFirst({
        where: { organizationId: target.orgId, name: target.at, isDeleted: false },
        select: { id: true, name: true, type: true },
      });
      return { item: found, wrongLocation: loc };
    });
    if (!item || !wrongLocation) {
      say(`OPENING ${target.item} @ ${target.at} — SKIPPED: item or location not found`);
      continue;
    }
    if (!isExternalLocation(wrongLocation.type)) {
      say(`OPENING ${target.item} @ ${target.at} — SKIPPED: already a location of ours`);
      continue;
    }

    const rows = await itemsService.getOpeningStock(item.id, target.orgId);
    /* The screen keeps only rows that actually DECLARE something; sending the
       rest back would turn a location the ledger merely touches into a
       declaration of opening stock nobody typed. */
    const declared = rows.filter((r) => r.openingStock !== null && r.openingStock !== undefined);
    const moving = declared.find((r) => r.locationId === wrongLocation.id);
    if (!moving) {
      say(`OPENING ${item.name} @ ${wrongLocation.name} — nothing declared there any more`);
      continue;
    }

    /**
     * 🔴 ONE ROW PER LOCATION, so the move MERGES rather than duplicates.
     *
     * `saveOpeningStock` soft-deletes every declaration for the item and rebuilds
     * from what it is handed, so two rows naming head office would become two
     * declaration rows for one location — and `readOpeningStock` takes the FIRST
     * it finds, leaving the grid showing one figure while the positions total
     * both. Merged here: quantities summed, batches concatenated, which is what
     * the two rows together already mean.
     */
    const merged = new Map<string, (typeof declared)[number]>();
    for (const row of declared) {
      const locationId = row.locationId === wrongLocation.id ? home.id : row.locationId;
      const existing = merged.get(locationId);
      if (!existing) {
        merged.set(locationId, { ...row, locationId });
        continue;
      }
      merged.set(locationId, {
        ...existing,
        openingStock: num(existing.openingStock) + num(row.openingStock),
        batches: [...existing.batches, ...row.batches],
      });
    }
    /**
     * 🔴 A DECLARED FIGURE THAT ITS OWN BATCHES ALREADY EXCEED.
     *
     * `saveOpeningStock` refuses `batchTotal > openingStock` — the scalar is the
     * quantity being declared and the batches are what it is made of, so batches
     * adding up to more is a row that cannot mean anything. swater's head office
     * row says 10 while carrying 890 of batches, which means its opening stock
     * could not be saved from the screen either, today, before any of this: press
     * Save on that item and the same 400 comes back.
     *
     * Raised to the batch total, and ONLY where the row already contradicts
     * itself. The batches are the half backed by ledger positions; the scalar is
     * a summary that drifted from them. Nothing moves — this posts no stock, it
     * makes the document say what its own rows already say.
     */
    const payload = [...merged.values()].map((row) => {
      const batchTotal = row.batches.reduce((sum, b) => sum + num(b.quantityIn), 0);
      if (batchTotal <= num(row.openingStock)) return row;
      say(
        `        ⚠ ${row.locationId.slice(0, 8)}… declares ${row.openingStock} but its batches` +
          ` total ${batchTotal} — raising the declared figure to match (posts nothing)`,
      );
      return { ...row, openingStock: batchTotal };
    });

    say(
      `OPENING ${item.name} — ${moving.openingStock} declared at ${wrongLocation.name} → ${home.name}` +
        ` (${moving.batches.length} batch; ${declared.length} declared row(s) → ${merged.size} after merge)`,
    );
    for (const row of payload) {
      say(
        `        ${row.locationId === home.id ? '→ ' : '  '}${row.locationId.slice(0, 8)}… ` +
          `qty ${row.openingStock}, ${row.batches.length} batch`,
      );
    }
    if (!APPLY) continue;

    const before = await balancesOf(target.orgId, item.id);
    await itemsService.saveOpeningStock(item.id, target.orgId, {
      locationRows: payload,
    } as Parameters<typeof itemsService.saveOpeningStock>[2]);
    const after = await balancesOf(target.orgId, item.id);

    /* 🔴 Prove the blast radius. The whole item's declaration was re-sent, so the
       only acceptable outcome is: that batch left the processor and arrived at
       ours, and every other position is untouched. Anything else is reported
       rather than assumed away. */
    const keys = new Set([...before.keys(), ...after.keys()]);
    const moves: string[] = [];
    for (const key of keys) {
      const delta = (after.get(key) ?? 0) - (before.get(key) ?? 0);
      if (Math.abs(delta) > 0.00005)
        moves.push(`${key.slice(0, 8)}…: ${delta > 0 ? '+' : ''}${delta}`);
    }
    say(`   ✓ ${moves.length === 0 ? 'no ledger change' : moves.join('  ')}`);
  }

  // -------------------------------------------------------------------------- BILLS
  for (const target of BILLS) {
    const home = await homeLocation(target.orgId);
    if (!home) {
      say(`BILL ${target.number} — SKIPPED: this org has no location of its own`);
      continue;
    }

    /**
     * 🔴 BY NUMBER **AND** BY THE DEFECT, never by number alone.
     *
     * `bill_number` is typed by a person and repeats: OCTFIS Prashant has two
     * bills numbered "123" — a draft at Home Branch and the open one at Global
     * Inc. A `findFirst` on the number picked the draft, i.e. the healthy one,
     * and would have "corrected" a record that was never wrong while leaving the
     * broken one alone. The location being external IS the defect, so it is part
     * of the lookup rather than a check afterwards.
     */
    const matches = await runAsTenant(target.orgId, (tx) =>
      tx.bill.findMany({
        where: { organizationId: target.orgId, billNumber: target.number, isDeleted: false },
        select: {
          id: true,
          billNumber: true,
          status: true,
          locationId: true,
          location: { select: { name: true, type: true } },
        },
      }),
    );
    const broken = matches.filter((b) => b.locationId && isExternalLocation(b.location?.type));
    if (broken.length === 0) {
      say(
        `BILL ${target.number} — SKIPPED: none of the ${matches.length} match(es) names a processor`,
      );
      continue;
    }
    if (broken.length > 1) {
      say(
        `BILL ${target.number} — SKIPPED: ${broken.length} bills share this number AND the defect`,
      );
      continue;
    }
    const bill = broken[0]!;

    // What this bill put there, and how much of it is still standing.
    const batchIds = await runAsTenant(target.orgId, (tx) =>
      tx.stockLedgerEntry
        .findMany({
          where: { organizationId: target.orgId, sourceDocType: 'bill', sourceDocId: bill.id },
          select: { batchId: true },
        })
        .then((rows) => [...new Set(rows.map((r) => r.batchId))]),
    );
    const standing = batchIds.length
      ? await runAsTenant(target.orgId, (tx) =>
          getBalancesByBatch(tx, {
            organizationId: target.orgId,
            locationId: bill.locationId!,
            batchIds,
          }),
        )
      : new Map();

    const toMove = [...standing.entries()].filter(([, b]) => b.qty.greaterThan(0));
    say(
      `BILL ${bill.billNumber} (${bill.status}) — ${bill.location?.name} → ${home.name}` +
        (toMove.length
          ? `, moving ${toMove.map(([, b]) => b.qty.toString()).join(' + ')}`
          : ', nothing left standing there'),
    );
    if (!APPLY) continue;

    for (const [batchId, balance] of toMove) {
      await runAsDocument(target.orgId, async (tx) => {
        const common = {
          organizationId: target.orgId,
          batchId,
          sourceDocType: 'correction',
          sourceDocId: bill.id,
          remarks: REASON,
          postedAt: new Date(),
        };
        await postMovement(tx, {
          ...common,
          locationId: bill.locationId!,
          movementType: 'transfer_out',
          qtyOut: balance.qty,
          valueOut: balance.value,
        });
        await postMovement(tx, {
          ...common,
          locationId: home.id,
          movementType: 'transfer_in',
          qtyIn: balance.qty,
          valueIn: balance.value,
        });
      });
    }
    await runAsTenant(target.orgId, (tx) =>
      tx.bill.update({ where: { id: bill.id }, data: { locationId: home.id } }),
    );
    say(`   ✓ ${toMove.length ? 'stock moved and ' : ''}bill now reads ${home.name}`);
  }

  say(APPLY ? '\nDone.\n' : '\nNothing was written. Re-run with --apply to carry this out.\n');
  await prisma.$disconnect();
}

await main();
