import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';
import { PROCESSOR_TYPES } from '../jobwork.types.ts';

/**
 * Request shapes for Issues — the challan out.
 *
 * 🔴 WHAT IS NOT HERE IS THE POINT.
 *
 * No `itemId`, no `uomId`, no `jobOrderId`: all three come from the step, which
 * the service reads. The dialog shows them locked (field-sources §5.1) and
 * accepting them from the body would let a payload issue an item the step never
 * planned for — breaking the chain the job order validated at save, with the
 * failure surfacing days later as an empty picker at the next step.
 *
 * No `challanNumber` either: `NumberSequence('job_issue')` allocates it in the
 * save transaction, so an abandoned dialog burns nothing (§2.2). A gap in a
 * statutory series is a question an auditor asks.
 *
 * And since 2026-08-10, no transport (`transporterId`, `vehicleNo`, `lrNo`,
 * `lrDate`, `ewayBillNo`) and no `customFields`. The four transport columns were
 * dropped from `job_issues` and `job_issue` is no longer a custom-field module,
 * so accepting any of them here would 500 on the write instead of 400ing here.
 */

export const jobIssueLineSchema = z.object({
  /**
   * 🔴 WHICH ITEM THIS LINE IS (domain §5.7). One challan carries fabric, thread
   * and buttons — one physical movement to one processor, so one document — and
   * the dialog renders a batch picker per input item, each section stamping its own
   * `itemId` onto the lines it produces.
   *
   * Optional only for the rollout: a client that sends nothing gets the step's
   * principal input, which is what every line meant before Sprint 5. The service
   * still refuses an item the step does not consume — the batch picker can only
   * offer what the step declared, so a line naming anything else was hand-made.
   */
  itemId: z.string().uuid().nullable().optional(),

  /**
   * ⚠️ TEMPORARY — optional HERE, and only for an item at `inventoryTracking =
   * 'none'`. Null means "there is no stock on record".
   *
   * 🔴 It is not optional in the SERVICE for a batch-tracked item: `resolveLines`
   * refuses a batch-less line for one, because that column is a promise that every
   * metre is traceable to its roll and an issue is where that trace is created.
   * The rule cannot live in this file — zod would have to read the item to know
   * which items it applies to — so it lives one layer down, where the item is
   * already loaded.
   *
   * Material In was retired before Purchase Received and Opening Stock exist, so
   * an untracked item can legitimately have no batches at all right now. Rather
   * than make the whole loop untestable, such a line has one created for it at
   * ZERO value (`resolveLines`), and the dialog says so on screen.
   *
   * 🔴 Make this required for every item the day Purchase Received lands. Issuing
   * stock that was never received is a defect, not a feature.
   */
  batchId: z.string().uuid().nullable().optional(),
  /**
   * 🔴 Which godown this line leaves from (2026-08-14). The picker offers one row
   * per (batch, location) because a challan may draw from every godown in a
   * dispatch site, so the client sends back the row it picked.
   *
   * Omitted, the header's dispatch location is assumed — which is what a
   * single-godown site always means, and what every pre-2026-08-14 client sends.
   */
  sourceLocationId: z.string().uuid().nullable().optional(),
  /**
   * 🔴 WHICH PACKAGE of the batch this line sends — a taka, roll or bale — when
   * the org runs a unit level.
   *
   * Set only for a package-granular issue. Omitted, the line draws on the batch's
   * UNTAGGED remainder, which is what every line written before the level existed
   * means and what an item with no package grid always means.
   *
   * Three packages of one batch are three lines, exactly as three batches are.
   */
  batchUnitId: z.string().uuid().nullable().optional(),
  /**
   * When `batchUnitId` is set this is how much of THAT package goes — checked
   * against what the package still holds, never against the batch.
   *
   * Part of a roll is a real answer: a roll already broken into is exactly the
   * one an operator sends the remainder of.
   */
  qty: z.coerce.number().positive('Every line needs a quantity greater than zero.'),
});

export type JobIssueLineInput = z.infer<typeof jobIssueLineSchema>;

export const createJobIssueSchema = openApiRegistry.register(
  'CreateJobIssueRequest',
  z.object({
    /** The step whose `[+ Issue]` was clicked. Everything else follows from it. */
    jobOrderStepId: z.string().uuid({ message: 'An issue must belong to a job order step.' }),

    issueDate: z.coerce.date().optional(),

    /** Defaults to the step's processor. Present so a one-off substitution does
     * not require editing the job order. */
    processorType: z.enum(PROCESSOR_TYPES).optional(),
    processorId: z.string().uuid().nullable().optional(),

    /** Which godown the goods leave. The dialog offers only locations that
     * actually hold the item — a ledger query, not a location list (§5.1). */
    sourceLocationId: z.string().uuid({ message: 'Pick where the material is going out from.' }),

    /**
     * Where they land. Normally omitted: the service derives the processor's own
     * location and creates it on first use, because making someone set up a
     * location for a dyer before they can send anything to that dyer is a gate
     * with no purpose (§5.1).
     */
    destinationLocationId: z.string().uuid().nullable().optional(),

    /** Set when launched from a receipt's rework line — same step, next attempt. */
    isRework: z.boolean().optional(),

    /**
     * Required by the SERVICE, not by this schema, and only when the issue goes
     * past the step's tolerance ceiling. Making it conditionally required here
     * would mean this file knowing the planned quantity, which it cannot.
     */
    toleranceOverrideReason: z.string().trim().max(2000).nullable().optional(),

    lines: z.array(jobIssueLineSchema).min(1, 'Pick at least one batch to issue.'),

    remarks: z.string().trim().max(2000).nullable().optional(),
  }),
);

export type CreateJobIssueInput = z.infer<typeof createJobIssueSchema>;

/**
 * Cancelling a challan. Not a delete and not an edit.
 *
 * 🔴 A posted issue has moved stock, and the ledger's only legal correction is a
 * REVERSING ENTRY (inventory.prisma). Cancelling posts the opposite rows and
 * flips the status; the original rows stay, so the history of "this went out and
 * came back on paper" survives. The reason is required for the same purpose —
 * a cancelled challan number is a question somebody will ask.
 */
export const cancelJobIssueSchema = openApiRegistry.register(
  'CancelJobIssueRequest',
  z.object({
    reason: z.string().trim().min(1, 'Say why this challan is being cancelled.').max(2000),
  }),
);

export type CancelJobIssueInput = z.infer<typeof cancelJobIssueSchema>;
