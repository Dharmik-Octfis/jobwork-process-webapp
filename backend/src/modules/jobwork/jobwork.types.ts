import { runAsTenant, type TenantClient } from '../../db/prisma.ts';

/**
 * The vocabularies Sprints 2–4 share, in one file rather than five.
 *
 * Same convention as `processes/processes.types.ts`: a `String @db.VarChar(n)`
 * with a `// a | b | c` comment in the schema, and the list in code. This
 * codebase has zero Prisma `enum` blocks, so adding a value is a code change
 * with no migration — and the price of that is exactly this file, because the
 * database will happily store a typo.
 */

/**
 * Who performs a step.
 *
 * `customer` is not a curiosity: in inward jobwork (domain doc shape D) the party
 * whose goods these are may also do one of the operations on them. Splitting it
 * out from `vendor` is what lets the processor dropdown query the right table —
 * a vendor picker offered on a customer step is how a transporter ends up on a
 * dyeing line.
 */
export const PROCESSOR_TYPES = ['vendor', 'customer', 'internal'] as const;
export type ProcessorType = (typeof PROCESSOR_TYPES)[number];

export function isProcessorType(value: string): value is ProcessorType {
  return (PROCESSOR_TYPES as readonly string[]).includes(value);
}

/**
 * A job order's life.
 *
 * 🔴 CALC+ — stored, and written ONLY by `jobOrders.status.ts`. It is never
 * accepted from a request body: a status a user can type is a status that
 * disagrees with the documents underneath it, and then two screens tell two
 * different stories about the same order.
 *
 * `short_closed` is the one that has to exist from the start. Real work ends
 * short — 5,000 m issued, 4,850 m back, the last 150 m lost in the process —
 * and without a way to say "this is finished even though the numbers do not
 * balance", every completed job order stays open forever and the list becomes
 * useless.
 */
export const JOB_ORDER_STATUSES = [
  'draft',
  'in_progress',
  'completed',
  'short_closed',
  'cancelled',
] as const;
export type JobOrderStatus = (typeof JOB_ORDER_STATUSES)[number];

/** A step's life, derived from its issues and receipts the same way. */
export const JOB_ORDER_STEP_STATUSES = [
  'pending',
  'issued',
  'partially_received',
  'completed',
  'short_closed',
] as const;
export type JobOrderStepStatus = (typeof JOB_ORDER_STEP_STATUSES)[number];

/**
 * An issue's life. `closed` means everything sent has been accounted for.
 *
 * `draft` is the odd one out: every other value is CALC+, derived from what the
 * receipts underneath have accounted for, while this one is chosen — by which
 * button was pressed — and nothing derives its way out of it.
 */
export const JOB_ISSUE_STATUSES = [
  'draft',
  'issued',
  'partially_received',
  'closed',
  'cancelled',
] as const;
export type JobIssueStatus = (typeof JOB_ISSUE_STATUSES)[number];

/**
 * A receipt's life. It had no list in code until drafts arrived — the vocabulary
 * lived in a schema comment and in `listFilters.catalog.ts`, which is exactly how
 * a third value gets added in one place and missed in the other.
 */
export const JOB_RECEIPT_STATUSES = ['draft', 'posted', 'cancelled'] as const;
export type JobReceiptStatus = (typeof JOB_RECEIPT_STATUSES)[number];

/**
 * 🔴 THE ONLY WAY TO ASK "DID THIS DOCUMENT ACTUALLY MOVE STOCK?"
 *
 * Put it in the `where` of every sum over issues or receipts. Never spell the
 * statuses out inline, and never fall back to `{ not: 'cancelled' }` — the same
 * reasoning as `ACTIVE_USER` in `lib/authGuards.ts`: two excluded values means
 * two chances to exclude only one, and the one that gets forgotten is the new one.
 *
 * A DRAFT IS THE DANGEROUS HALF. A cancelled document has reversing ledger rows,
 * so counting it merely double-counts a zero. A draft has LINES AND TOTALS AND NO
 * LEDGER ROWS AT ALL — it is a challan that says 4,800 m left the godown while the
 * ledger says nothing did. Count one and the step reports material at a processor
 * that never went anywhere, the next step's chain guard opens on it, and the
 * Overview and the stock report disagree with no way to tell which is lying.
 *
 * `jobwork.drafts.test.ts` pins this: it saves a draft on both sides and asserts
 * the step's totals, the ledger and the job order status are all untouched.
 */
const NOT_POSTED: string[] = ['draft', 'cancelled'];
export const POSTED_DOC_STATUS = { notIn: NOT_POSTED };

/**
 * "Did this document ever happen?" — a different question from the one above, and
 * the one the ACTIVITY TIMELINE asks.
 *
 * A cancelled challan belongs on a timeline: it went out on the 3rd and was
 * cancelled on the 5th, and hiding it leaves a gap between two numbers that no
 * longer explain each other. A draft does not: nothing has happened yet, and
 * listing one as "4,800 m issued to Sunrise Dyers" describes goods that are still
 * in the godown.
 */
export const HAPPENED_DOC_STATUS = { not: 'draft' } as const;

/**
 * 🔴 NOT A USER PREFERENCE. `Process.preservesPackaging` decides this, and the
 * receipt copies the answer at save time (field-sources §6.1).
 *
 * Dyeing returns the same roll, so each taka can be received individually and
 * mapped back to the one that went out. Cutting destroys the roll, so there is
 * no roll to map — only a bulk quantity. Offering the choice is how someone
 * picks unit-wise for an operation where no 1:1 mapping can physically exist,
 * and the mapping they then record is fiction.
 */
export const RECEIPT_MODES = ['unit_wise', 'bulk'] as const;
export type ReceiptMode = (typeof RECEIPT_MODES)[number];

/**
 * What happened to the goods that came back. The four must sum to the received
 * quantity — the receipt service refuses the save otherwise, and that one check
 * is what makes a separate "Rejection Note" document unnecessary (§6.4).
 *
 * 🔴 `returned` is the odd one out and must stay that way: goods handed straight
 * back at the gate never entered our stock, so NO ledger row is written for
 * them. Writing one would create quantity that was never physically ours.
 */
export const DISPOSITIONS = ['accepted', 'rework', 'scrap', 'returned'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

/** Whose fault. Drives whether rework is re-charged or done free. */
export const RESPONSIBILITIES = ['ours', 'theirs'] as const;
export type Responsibility = (typeof RESPONSIBILITIES)[number];

/**
 * 🔴 LOCATION TYPES THAT ARE NOT OUR PREMISES.
 *
 * Goods at a processor are OUR stock at THEIR location (§5.4) — one axis, not a
 * location plus a separate "with processor" state. That is what makes "stock
 * lying with processors" a plain ledger query, and it is also why a balance
 * summed across every location reads as stock on hand when part of it is
 * material still out at a vendor.
 *
 * Any screen showing a per-location breakdown has to draw this line, so it is
 * drawn ONCE. `web/.../ReceiveDialog.tsx` picked the same two types
 * independently for its godown dropdown; a second copy of a rule is a second
 * chance for the two to disagree about what "in stock" means.
 */
export const EXTERNAL_LOCATION_TYPES = ['processor', 'in_transit', 'customer_site'] as const;

export function isExternalLocation(type: string | null | undefined): boolean {
  return EXTERNAL_LOCATION_TYPES.includes(type as (typeof EXTERNAL_LOCATION_TYPES)[number]);
}

/**
 * `sourceDocType` values this domain writes onto batches and ledger rows. They are
 * strings on purpose (`stock_ledger.source_doc_type` is not an FK — the table it
 * points at differs per value), which is exactly why they need one list: a
 * document type spelled two ways is a report that silently under-counts.
 */
export const SOURCE_DOC_TYPES = {
  jobOrderMaterialIn: 'job_order_material_in',
  jobIssue: 'job_issue',
  jobReceipt: 'job_receipt',
} as const;

/**
 * 🔴 Transaction budget for a jobwork document. Prisma's default interactive
 * transaction timeout is 5 SECONDS, and every one of these documents blows it.
 *
 * A fifty-taka consignment is the domain's own worked example, not a stress
 * case: Material In writes the batch, fifty packages and fifty ledger rows; the
 * issue that follows writes fifty lines and a hundred ledger rows (out at the
 * godown, in at the processor); the receipt consumes fifty and produces fifty.
 * Each of those goes through `postMovement`, which re-reads the batch every time
 * — deliberately, because a ledger row that disagrees with its own batch is not a
 * number anyone can correct later. Over a network that is comfortably past five
 * seconds, and the failure is the worst possible shape: the document half-writes
 * and the transaction dies, so the user sees an internal error on a save that
 * looked fine.
 *
 * Raising the budget is the right fix rather than batching the writes. The
 * alternative is a `createMany` that skips the per-row validation, which trades
 * a slow save for a ledger nobody can trust — and the ledger is the one thing in
 * this domain that cannot be repaired after the fact. If this ever becomes a
 * measured problem, cache the batch reads inside `postMovement` (as its own
 * comment says), do not bypass them.
 *
 * `maxWait` is how long to wait for a connection from the pool before starting;
 * `timeout` is how long the transaction may then run.
 */
const DOCUMENT_TX = { maxWait: 15_000, timeout: 120_000 } as const;

/**
 * `runAsTenant` with that budget. Every jobwork document write goes through
 * this instead of `runAsTenant` directly — a name rather than an options object
 * repeated at five call sites, because the one that gets forgotten is the one
 * that fails, and it fails only on the biggest consignments.
 *
 * Reads keep using plain `runAsTenant`: a list query that takes five seconds is
 * a problem to fix, not to give more time to.
 */
export function runAsDocument<T>(
  organizationId: string,
  fn: (tx: TenantClient) => Promise<T>,
): Promise<T> {
  return runAsTenant(organizationId, fn, DOCUMENT_TX);
}
