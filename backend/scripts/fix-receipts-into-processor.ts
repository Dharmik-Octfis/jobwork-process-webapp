/**
 * ONE-OFF CORRECTION — receipts that landed goods at a jobworker who never held them.
 *
 * Between 2026-09-03 and 2026-09-07 the Receive screen's location filter was
 * missing, so "Received into" offered every processor's shed and defaulted to
 * whichever came back first. Eight posted receipts landed their output at a
 * processor that had done no work on it and held no challan for it — a transfer
 * between two premises with no document behind it. The rule is back
 * (`assertReceivableLocation`); this repairs what was written while it was gone.
 *
 * 🔴 IT WRITES NOTHING WITHOUT `--apply`. Run it once to read the plan.
 *
 *     npx tsx scripts/fix-receipts-into-processor.ts
 *     npx tsx scripts/fix-receipts-into-processor.ts --apply
 *
 * THREE GROUPS, because the ledger allows three different corrections:
 *
 *   RE-RECEIVE   The challans are real and nothing has moved since, so the receipt
 *                is cancelled — which reverses every row it posted — and raised
 *                again against the same challans, landing where the goods actually
 *                are: with the processor that made them. That is the dispatch-onward
 *                case, and it is legal now.
 *
 *   CANCEL ONLY  JR-00019 / JR-00020 have NO challan and NO consumption: each
 *                posted a single `produce` row, so 90 shirts appeared out of
 *                nothing. There is no material behind them to re-receive, so the
 *                cancellation is the whole correction.
 *
 *   TRANSFER     JR-00016 / JR-00017 cannot be cancelled — 310 of their 400 Cloth
 *                has already been issued onward, and reversing would strand stock
 *                the next step is holding. Only the 90 still standing at ABC LLP
 *                is misplaced, so it is moved with a paired ledger entry. Nothing
 *                is edited or deleted: the ledger has no way to say "this never
 *                happened", only "the opposite happened later".
 */
import { prisma, runAsTenant } from '../src/db/prisma.ts';
import {
  getBalancesByBatch,
  postMovement,
} from '../src/modules/inventory/stock-ledger/stockLedger.service.ts';
import { isExternalLocation, runAsDocument } from '../src/modules/jobwork/jobwork.types.ts';
import {
  cancelJobReceipt,
  createNewJobReceipt,
} from '../src/modules/jobwork/receipts/jobReceipts.service.ts';

const APPLY = process.argv.includes('--apply');
const REASON =
  'Received into a processor location that never held these goods — corrected 2026-09-07.';

/**
 * 🔴 TARGETED BY ORGANIZATION **AND** NUMBER, never by number alone.
 *
 * `receipt_number` is a per-tenant sequence, so JR-00002 exists in every
 * organization that has raised two receipts. A first draft of this script listed
 * the numbers on their own and its dry run offered to cancel seven healthy
 * receipts in five other tenants — including two test orgs' — because they
 * happened to share a number. The pair is the identity; the precondition below
 * is the second lock.
 */
const PLAN = [
  // OCTFIS TECHNO LLP
  { orgId: 'a02a9057-83c2-40b8-9adc-2e90057e19be', num: 'JR-00016', action: 'transfer' },
  { orgId: 'a02a9057-83c2-40b8-9adc-2e90057e19be', num: 'JR-00017', action: 'transfer' },
  { orgId: 'a02a9057-83c2-40b8-9adc-2e90057e19be', num: 'JR-00019', action: 'cancel' },
  { orgId: 'a02a9057-83c2-40b8-9adc-2e90057e19be', num: 'JR-00020', action: 'cancel' },
  { orgId: 'a02a9057-83c2-40b8-9adc-2e90057e19be', num: 'JR-00021', action: 're-receive' },
  { orgId: 'a02a9057-83c2-40b8-9adc-2e90057e19be', num: 'JR-00022', action: 're-receive' },
  { orgId: 'a02a9057-83c2-40b8-9adc-2e90057e19be', num: 'JR-00023', action: 're-receive' },
  // OCTFIS Prashant LLP
  { orgId: '99ad5fe2-b1c4-482a-b596-d56cef5b49d7', num: 'JR-00002', action: 're-receive' },
] as const;

const say = (line: string) => console.log(line);

async function main() {
  say(APPLY ? '\n=== APPLYING ===\n' : '\n=== DRY RUN — nothing will be written ===\n');

  const orgIds = [...new Set(PLAN.map((row) => row.orgId))];
  const orgs = await prisma.organization.findMany({
    where: { id: { in: orgIds } },
    select: { id: true, name: true },
  });
  /** Batches already moved by the TRANSFER group, so two receipts sharing one
   * batch do not move the same 90 metres twice. */
  const movedBatches = new Set<string>();

  for (const org of orgs) {
    const forOrg = PLAN.filter((row) => row.orgId === org.id);
    const actionOf = new Map<string, (typeof PLAN)[number]['action']>(
      forOrg.map((row) => [row.num, row.action]),
    );
    const receipts = await runAsTenant(org.id, (tx) =>
      tx.jobReceipt.findMany({
        where: {
          organizationId: org.id,
          isDeleted: false,
          status: 'posted',
          receiptNumber: { in: forOrg.map((row) => row.num) },
        },
        select: {
          id: true,
          receiptNumber: true,
          receiptDate: true,
          jobOrderStepId: true,
          locationId: true,
          remarks: true,
          location: { select: { name: true, type: true } },
          lines: {
            select: {
              jobIssueId: true,
              jobIssueLineId: true,
              issuedQty: true,
              receivedQty: true,
              acceptedQty: true,
              reworkQty: true,
              scrapQty: true,
              returnedQty: true,
              reasonId: true,
              responsibility: true,
            },
          },
          outputs: {
            select: {
              itemId: true,
              uomId: true,
              receivedQty: true,
              acceptedQty: true,
              reworkQty: true,
              scrapQty: true,
              returnedQty: true,
              isPrimary: true,
              item: { select: { name: true } },
              batches: { select: { batchId: true, kind: true, qty: true } },
            },
          },
        },
        orderBy: { receiptNumber: 'asc' },
      }),
    );
    if (receipts.length === 0) continue;

    say(`\n### ${org.name}`);

    for (const receipt of receipts) {
      const num = receipt.receiptNumber;
      const action = actionOf.get(num);

      /* 🔴 The second lock. Every receipt here is one that landed goods at a
         processor; a receipt sitting in one of our own locations is not this
         defect and must never be touched by a script that repairs it. */
      if (!isExternalLocation(receipt.location?.type)) {
        say(`${num}  SKIPPED — landed at ${receipt.location?.name}, which is a location of ours`);
        continue;
      }

      // ---------------------------------------------------------------- CANCEL ONLY
      if (action === 'cancel') {
        say(
          `${num}  CANCEL ONLY — ${receipt.outputs
            .map((o) => `${o.item?.name ?? '?'} ${o.receivedQty}`)
            .join(', ')} at ${receipt.location?.name}, posted with no challan and nothing consumed`,
        );
        if (APPLY) {
          await cancelJobReceipt(org.id, receipt.id, REASON);
          say(`   ✓ cancelled`);
        }
        continue;
      }

      // ------------------------------------------------------------------ TRANSFER
      if (action === 'transfer') {
        const batchIds = [
          ...new Set(receipt.outputs.flatMap((o) => o.batches.map((b) => b.batchId))),
        ].filter((id) => !movedBatches.has(id));
        if (batchIds.length === 0) {
          say(`${num}  TRANSFER — its batch is already covered by an earlier row here`);
          continue;
        }

        // Where should it go? Their own godown: the goods are not with ABC LLP.
        const home = await runAsTenant(org.id, (tx) =>
          tx.location.findFirst({
            where: { organizationId: org.id, name: 'head office', isDeleted: false },
            select: { id: true, name: true },
          }),
        );
        if (!home) {
          say(`${num}  TRANSFER — SKIPPED: no "head office" location in this org`);
          continue;
        }

        const balances = await runAsTenant(org.id, (tx) =>
          getBalancesByBatch(tx, {
            organizationId: org.id,
            locationId: receipt.locationId,
            batchIds,
          }),
        );

        for (const batchId of batchIds) {
          const standing = balances.get(batchId);
          if (!standing || standing.qty.lessThanOrEqualTo(0)) {
            say(`${num}  TRANSFER — nothing left at ${receipt.location?.name}, no move needed`);
            movedBatches.add(batchId);
            continue;
          }
          say(
            `${num}  TRANSFER — ${standing.qty} (value ${standing.value}) from ` +
              `${receipt.location?.name} → ${home.name}, batch ${batchId.slice(0, 8)}`,
          );
          if (APPLY) {
            await runAsDocument(org.id, async (tx) => {
              const common = {
                organizationId: org.id,
                batchId,
                sourceDocType: 'correction',
                sourceDocId: receipt.id,
                remarks: REASON,
                postedAt: new Date(),
              };
              await postMovement(tx, {
                ...common,
                locationId: receipt.locationId,
                movementType: 'transfer_out',
                qtyOut: standing.qty,
                valueOut: standing.value,
              });
              await postMovement(tx, {
                ...common,
                locationId: home.id,
                movementType: 'transfer_in',
                qtyIn: standing.qty,
                valueIn: standing.value,
              });
            });
            say(`   ✓ moved`);
          }
          movedBatches.add(batchId);
        }
        continue;
      }

      // ---------------------------------------------------------------- RE-RECEIVE
      const issueIds = [
        ...new Set(receipt.lines.map((l) => l.jobIssueId).filter(Boolean)),
      ] as string[];
      const issues = await runAsTenant(org.id, (tx) =>
        tx.jobIssue.findMany({
          where: { organizationId: org.id, id: { in: issueIds } },
          select: {
            challanNumber: true,
            destinationLocationId: true,
            destination: { select: { name: true } },
          },
        }),
      );
      const dests = [...new Set(issues.map((i) => i.destinationLocationId))];
      if (dests.length !== 1) {
        say(`${num}  RE-RECEIVE — SKIPPED: its challans stand at ${dests.length} locations`);
        continue;
      }
      const landAt = dests[0]!;

      say(
        `${num}  RE-RECEIVE — cancel, then raise again against ` +
          `${issues.map((i) => i.challanNumber).join(', ')}, landing at ` +
          `${issues[0]?.destination?.name} instead of ${receipt.location?.name}`,
      );
      for (const o of receipt.outputs) {
        say(
          `   ${o.item?.name ?? '?'} received ${o.receivedQty} · accepted ${o.acceptedQty}` +
            ` · ${o.batches.length} batch, topped up by id so the label survives`,
        );
      }
      if (!APPLY) continue;

      await cancelJobReceipt(org.id, receipt.id, REASON);
      say(`   ✓ cancelled`);

      try {
        const raised = await createNewJobReceipt(org.id, {
          jobOrderStepId: receipt.jobOrderStepId,
          receiptDate: receipt.receiptDate,
          issueIds,
          locationId: landAt,
          remarks: [receipt.remarks, `Re-raised from ${num}: ${REASON}`]
            .filter(Boolean)
            .join(' · '),
          lines: receipt.lines.map((l) => ({
            jobIssueId: l.jobIssueId,
            jobIssueLineId: l.jobIssueLineId,
            issuedQty: Number(l.issuedQty),
            receivedQty: Number(l.receivedQty),
            acceptedQty: Number(l.acceptedQty),
            reworkQty: Number(l.reworkQty),
            scrapQty: Number(l.scrapQty),
            returnedQty: Number(l.returnedQty),
            reasonId: l.reasonId,
            responsibility: l.responsibility as 'ours' | 'theirs' | null,
          })),
          outputs: receipt.outputs.map((o) => ({
            itemId: o.itemId,
            uomId: o.uomId,
            receivedQty: Number(o.receivedQty),
            acceptedQty: Number(o.acceptedQty),
            reworkQty: Number(o.reworkQty),
            scrapQty: Number(o.scrapQty),
            returnedQty: Number(o.returnedQty),
            isPrimary: o.isPrimary,
            // 🔴 The SAME batches, topped up by id — a new label would leave the
            // next step's picker showing two batches where one roll exists.
            batches: o.batches
              .filter((b) => b.kind === 'accepted')
              .map((b) => ({ batchId: b.batchId, qty: Number(b.qty) })),
            reworkBatches: o.batches
              .filter((b) => b.kind === 'rework')
              .map((b) => ({ batchId: b.batchId, qty: Number(b.qty) })),
          })),
        });
        say(`   ✓ raised as ${raised.receiptNumber}`);
      } catch (error) {
        say(
          `   ⚠ CANCELLED BUT NOT RE-RAISED — ${(error as Error).message}\n` +
            `     Raise it by hand: step ${receipt.jobOrderStepId}, challans ` +
            `${issues.map((i) => i.challanNumber).join(', ')}, received into ` +
            `${issues[0]?.destination?.name}.`,
        );
      }
    }
  }

  say(APPLY ? '\nDone.\n' : '\nNothing was written. Re-run with --apply to carry this out.\n');
  await prisma.$disconnect();
}

await main();
