import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';
import { RESPONSIBILITIES } from '../jobwork.types.ts';

/**
 * Request shapes for Receipts — goods coming back.
 *
 * 🔴 `mode` IS NOT ACCEPTED FROM THE CLIENT. `Process.preservesPackaging` decides
 * it and the service copies the answer (§6.1). Dyeing returns the same roll, so
 * taka-by-taka is possible; cutting destroys the roll, so there is no roll to map
 * back to. Offering it as a choice is how someone records a 1:1 mapping that
 * cannot physically exist — and once recorded, nothing downstream can tell it is
 * fiction.
 */

export const jobReceiptLineSchema = z
  .object({
    /** Which issue line came back. Present in unit-wise mode; a bulk receipt
     * spanning several issues has no single line to point at. */
    jobIssueId: z.string().uuid().nullable().optional(),
    jobIssueLineId: z.string().uuid().nullable().optional(),

    /**
     * 🔴 WHICH ITEM THIS LINE CONSUMES (§5.7).
     *
     * Required on a bulk line whenever the challans carry more than one item:
     * without it the allocation walks the open lines oldest-first across ALL
     * items and would settle a panel receipt by consuming thread. A unit-wise
     * line names its issue line, which already answers the question.
     */
    itemId: z.string().uuid().nullable().optional(),

    /** 🔴 The taka that went out. The ONLY place the 1:1 mapping can be recorded
     * (§6.2) — it cannot be reconstructed from quantities afterwards. */
    parentPackageId: z.string().uuid().nullable().optional(),

    /** How much of the INPUT this line accounts for, in the input's unit.
     * Read-only on screen in unit-wise mode: it is what the issue said. */
    issuedQty: z.coerce.number().min(0).optional(),

    /** The one typed column in unit-wise mode, in the OUTPUT item's unit. */
    receivedQty: z.coerce.number().min(0),

    acceptedQty: z.coerce.number().min(0).optional(),
    reworkQty: z.coerce.number().min(0).optional(),
    scrapQty: z.coerce.number().min(0).optional(),
    /** Handed straight back at the gate. 🔴 No ledger row is written for it — it
     * never entered our stock (§6.4). */
    returnedQty: z.coerce.number().min(0).optional(),

    reasonId: z.string().uuid().nullable().optional(),
    responsibility: z.enum(RESPONSIBILITIES).nullable().optional(),
    remarks: z.string().trim().max(2000).nullable().optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (line) => {
      const split =
        (line.acceptedQty ?? 0) +
        (line.reworkQty ?? 0) +
        (line.scrapQty ?? 0) +
        (line.returnedQty ?? 0);
      // Compared at four decimals — the column's own precision. An exact float
      // comparison would reject 3 × 33.3333 for being a billionth off.
      return Math.abs(split - line.receivedQty) < 0.00005;
    },
    {
      message:
        'Accepted + rework + scrap + returned must equal the received quantity on every line.',
      path: ['receivedQty'],
    },
  );

export type JobReceiptLineInput = z.infer<typeof jobReceiptLineSchema>;

/**
 * 🔴 ONE ITEM THAT CAME BACK (domain §5.7).
 *
 * The receipt has TWO child lists and they are different lengths: what was
 * consumed (`lines`, keyed to the challan lines they close) and what was
 * returned (this). Cutting consumes one fabric and returns panels, offcuts and
 * waste; stitching consumes three items and returns two. Seven items in and one
 * out is as normal as one in and ten out — the two sides are unrelated.
 *
 * The disposition split lives HERE rather than on the consumption row, because
 * "2,880 accepted" is a statement about shirts, not about the panels that went
 * out.
 */
export const jobReceiptOutputSchema = z
  .object({
    itemId: z.string().uuid({ message: 'Every returned row needs an item.' }),
    /** Forced from the item's stocking unit; accepted so the client can send
     * back what it displayed. */
    uomId: z.string().uuid().nullable().optional(),

    receivedQty: z.coerce.number().min(0),
    acceptedQty: z.coerce.number().min(0).optional(),
    reworkQty: z.coerce.number().min(0).optional(),
    scrapQty: z.coerce.number().min(0).optional(),
    /** Handed straight back at the gate. 🔴 No ledger row — it never entered our
     * stock (§6.4). */
    returnedQty: z.coerce.number().min(0).optional(),

    /**
     * 🔴 Exactly one output per receipt carries this. It absorbs the pot —
     * consumed value plus the process charge — less whatever the by-products
     * were given (§9.2.1). Omitted on every row, the primary is derived from the
     * consumption lines, which is what a pre-Sprint-5 client sends.
     */
    isPrimary: z.boolean().optional(),

    /**
     * By-products only: what this row is worth, deducted from the primary's
     * share. Default 0 is the honest answer rather than a placeholder — offcuts
     * carry no cost until somebody sells them, and the surviving primary should
     * carry the cost of the whole operation (§9.2.1).
     *
     * 🔴 Apportioning by quantity is NOT offered: 2,910 PCS and 80 KG have no
     * ratio between them, and inventing one is the conversion §5.1 forbids.
     */
    valueShare: z.coerce.number().min(0).nullable().optional(),

    reasonId: z.string().uuid().nullable().optional(),
    responsibility: z.enum(RESPONSIBILITIES).nullable().optional(),
    remarks: z.string().trim().max(2000).nullable().optional(),
  })
  .refine(
    (row) => {
      const split =
        (row.acceptedQty ?? 0) +
        (row.reworkQty ?? 0) +
        (row.scrapQty ?? 0) +
        (row.returnedQty ?? 0);
      return Math.abs(split - row.receivedQty) < 0.00005;
    },
    {
      message:
        'Accepted + rework + scrap + returned must equal the received quantity on every returned item.',
      path: ['receivedQty'],
    },
  );

export type JobReceiptOutputInput = z.infer<typeof jobReceiptOutputSchema>;

export const createJobReceiptSchema = openApiRegistry.register(
  'CreateJobReceiptRequest',
  z.object({
    jobOrderStepId: z.string().uuid({ message: 'A receipt must belong to a job order step.' }),
    receiptDate: z.coerce.date().optional(),

    /** One receipt may close several challans — a processor often returns two
     * consignments together (§6.1). */
    issueIds: z.array(z.string().uuid()).min(1, 'Pick at least one challan to receive against.'),

    /** Defaults to the step's receive item. Editable: what comes back is
     * sometimes not what was planned, and forcing a job order edit to record that
     * is how people stop recording it. */
    outputItemId: z.string().uuid().nullable().optional(),
    outputUomId: z.string().uuid().nullable().optional(),

    /** Where the goods landed — ours again, so a godown. */
    locationId: z.string().uuid({ message: 'Say where the goods were received.' }),

    /** The CONSUMPTION side: how much of each challan line this receipt accounts
     * for. In unit-wise mode each line is one taka and carries the disposition
     * that built the primary output's packages. */
    lines: z.array(jobReceiptLineSchema).min(1, 'A receipt needs at least one line.'),

    /**
     * 🔴 The RETURN side, one row per item (§5.7). Left empty, one output is
     * derived from the lines and the header's output item — exactly what
     * Sprints 1–4 did, which is what keeps the old Receive dialog working.
     */
    outputs: z.array(jobReceiptOutputSchema).optional(),

    remarks: z.string().trim().max(2000).nullable().optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
  }),
);

export type CreateJobReceiptInput = z.infer<typeof createJobReceiptSchema>;

/**
 * Cancelling a receipt. Same rule as an issue: reversing entries, never a delete.
 * Harder to justify and therefore harder to do — a receipt has already created
 * lots, and those lots may have been issued onward.
 */
export const cancelJobReceiptSchema = openApiRegistry.register(
  'CancelJobReceiptRequest',
  z.object({
    reason: z.string().trim().min(1, 'Say why this receipt is being cancelled.').max(2000),
  }),
);

export type CancelJobReceiptInput = z.infer<typeof cancelJobReceiptSchema>;
