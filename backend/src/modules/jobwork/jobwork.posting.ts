import { Prisma } from '../../../generated/prisma/client.ts';
import type { TenantClient } from '../../db/prisma.ts';
import { POSTED_DOC_STATUS } from './jobwork.types.ts';

/**
 * What a posting may still consume, and the lock that keeps that answer true
 * until the posting commits. Shared by issues, receipts and job orders so that
 * none of those services imports another (landed-cost plan §6.0).
 */

const ZERO = new Prisma.Decimal(0);

/**
 * 🔴 Serialise every posting on one step (landed-cost plan §6.0, bug 2).
 *
 * Nothing else here takes a row lock, so two receipts posted together on the same
 * challans both read the same outstanding quantity and both consume it. Call this
 * as the FIRST statement of a posting transaction: everything read after it sees
 * whatever the previous holder committed, so no decision is made on stale data.
 *
 * `FOR NO KEY UPDATE`, not `FOR UPDATE`: it still conflicts with itself, but not
 * with the `KEY SHARE` lock an insert takes through a foreign key — so a draft
 * saving lines under this step is not made to queue behind a posting.
 *
 * `organization_id` is filtered here too; RLS is the second layer, not the first.
 */
export async function lockStep(tx: TenantClient, organizationId: string, stepId: string) {
  await tx.$queryRaw`
    SELECT id FROM job_order_steps
    WHERE id = ${stepId}::uuid AND organization_id = ${organizationId}::uuid
    FOR NO KEY UPDATE`;
}

/**
 * Every step of a job order, locked in `seq` order — Postgres takes row locks in
 * the order the sorted rows come back. A single-step posting holds only one step
 * lock, so this cannot form a cycle with it.
 */
export async function lockJobOrderSteps(
  tx: TenantClient,
  organizationId: string,
  jobOrderId: string,
) {
  await tx.$queryRaw`
    SELECT id FROM job_order_steps
    WHERE job_order_id = ${jobOrderId}::uuid AND organization_id = ${organizationId}::uuid
    ORDER BY seq, id
    FOR NO KEY UPDATE`;
}

/**
 * How much of each issue line has already been received.
 *
 * 🔴 ONE grouped query, never one per line. This was a `jobReceiptLine.aggregate`
 * inside the loop in three places — invisible on a two-line challan and the whole
 * response on a fifty-line one. `Promise.all` could not have rescued it either:
 * every query on `tx` shares one connection and runs in turn.
 */
export async function closedQtyByIssueLine(
  tx: TenantClient,
  organizationId: string,
  lineIds: readonly string[],
): Promise<Map<string, Prisma.Decimal>> {
  if (lineIds.length === 0) return new Map();
  const grouped = await tx.jobReceiptLine.groupBy({
    by: ['jobIssueLineId'],
    where: {
      organizationId,
      jobIssueLineId: { in: [...lineIds] },
      isDeleted: false,
      /**
       * 🔴 A CANCELLED RECEIPT CLOSES NOTHING (2026-09-02).
       *
       * This counted every receipt line ever written, cancelled ones included, so
       * cancelling a receipt reversed its stock and reopened its challans — and
       * then left them permanently un-receivable. The challan showed as
       * `partially_received` with ZERO outstanding, and a second attempt to
       * receive the same goods was refused with "N more is being received than
       * these challans still have outstanding."
       *
       * A cancellation is the document saying it never happened. The stock,
       * the challan's status and the quantity it has left to account for all have
       * to agree about that, and this was the one that did not.
       */
      // Drafts excluded with cancellations: a parked receipt has consumed
      // nothing, so counting its lines would show a challan as closed while the
      // goods are still at the processor — and refuse the real receipt when it
      // arrives, with the same "more is being received than is outstanding"
      // message described above.
      jobReceipt: { status: POSTED_DOC_STATUS },
    },
    _sum: { issuedQty: true },
  });
  // `jobIssueLineId` is nullable — a bulk receipt spanning several challans points
  // at no single line — so the null group is dropped rather than keyed on.
  return new Map(
    grouped.flatMap((row) =>
      row.jobIssueLineId ? [[row.jobIssueLineId, row._sum.issuedQty ?? ZERO] as const] : [],
    ),
  );
}
