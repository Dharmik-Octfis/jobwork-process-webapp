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
 * 🔴 ONE BATCH THE RETURNED GOODS LAND IN, and there may be several per row.
 *
 * A row is EITHER an existing batch (`batchId`) or a new one to be created under
 * a label (`batchReference`), never both and never neither. The two are not
 * variations of the same thing:
 *
 *   · a NEW batch is the normal case — a processor returns a physically new
 *     thing with no number of its own, so somebody has to name it;
 *   · an EXISTING batch is the second half of a split delivery. 500 m of dye lot
 *     23 arrives today and 500 m tomorrow; without this the second delivery can
 *     only become a second batch carrying a duplicate label, and a recall on lot
 *     23 then finds half the stock.
 *
 * Which existing batches may be named is decided by the SERVICE, not here — it
 * needs the item, the ownership pair and the job order to answer, and none of
 * them are visible to zod.
 */
const outputBatchAllocationSchema = z
  .object({
    /** An existing batch to add to. */
    batchId: z.string().uuid().nullable().optional(),
    /** The label for a batch to create. Required for a batch-tracked item, which
     * `createBatch` enforces — whether it is needed depends on the ITEM. */
    batchReference: z.string().trim().max(100).nullable().optional(),
    qty: z.coerce.number().positive('Every batch row needs a quantity greater than zero.'),

    /**
     * 🔴 THE NEW BATCH'S OWN ATTRIBUTES, and receipt time is the only moment they
     * can be stated. What a processor hands back is physically new, and the
     * person standing at the delivery is the only one who knows what the maker's
     * tag says or when the dye lot was made. Left to the batch's own screen
     * afterwards they were never filled in — and "which batches expire in 30
     * days" is the entire reason a factory records an expiry.
     *
     * Refused beside a `batchId` (see the refine below): an existing batch is
     * added to and never restamped from inside a receipt. Silently ignoring them
     * there would be worse — somebody would type an expiry onto the second half
     * of a split delivery and believe it had been recorded.
     */
    manufacturerBatch: z.string().trim().max(100).nullable().optional(),
    manufacturedDate: z.coerce.date().nullable().optional(),
    expiryDate: z.coerce.date().nullable().optional(),
    /** Nullable rather than defaulted: most batches carry neither, and a zero
     * would read as "free" instead of "not stated". */
    sellingPrice: z.coerce.number().min(0).nullable().optional(),
    mrp: z.coerce.number().min(0).nullable().optional(),

    /**
     * 🔴 THE PACKAGES INSIDE THIS BATCH — the takas, rolls or bales the processor
     * physically handed back, when the org runs a unit level.
     *
     * Allowed on BOTH kinds of row, unlike the attributes above, and the asymmetry
     * is deliberate: restamping an existing batch's expiry rewrites a fact about
     * goods that already exist, whereas adding packages to it records goods that
     * have just arrived. The second half of a split delivery is three more rolls,
     * not a correction to the first half's.
     *
     * 🔴 Naming them is optional; naming SOME of them is not (2026-09-02). Name
     * none and the whole batch comes back untagged, exactly as before the level
     * existed. Name one and they must add up to `qty` — enforced here AND beside
     * the write, since this schema runs on the HTTP route alone.
     */
    units: z
      .array(
        z
          .object({
            /**
             * Set to TOP UP a package that already exists rather than name a new
             * one — the same roll coming back a second time. Mutually exclusive
             * with `label`, exactly as `batchId` and `batchReference` are one
             * level up, and for the same reason: a label is a physical tag, so
             * re-typing an existing one is a duplicate and not an addition.
             */
            batchUnitId: z.string().uuid().optional(),
            /** 🔴 Optional since 2026-09-03 — a roll the processor handed back with
             * no tag on it is auto-named `#seq`. Only the quantity is required. */
            label: z.string().trim().max(60).optional(),
            qty: z.coerce.number().positive('Every unit needs a quantity greater than zero.'),
          })
          /* 🔴 "Not BOTH", no longer "exactly one" — a row with NEITHER is now the
             ordinary case: a package that arrived without a tag. */
          .refine((unit) => !(unit.batchUnitId && unit.label?.trim()), {
            message: 'A unit row is either an existing unit or a new one, not both.',
            path: ['label'],
          }),
      )
      .optional(),
  })
  .refine(
    (row) => {
      // 🔴 An EQUALITY since 2026-09-02: naming any package commits to naming
      // them all, so a batch is broken down completely or not at all. Naming NONE
      // stays legal, which is what keeps every org without the level working.
      const units = row.units ?? [];
      if (units.length === 0) return true;
      const total = units.reduce((sum, unit) => sum + unit.qty, 0);
      return Math.abs(total - row.qty) < 0.00005;
    },
    {
      message:
        'The units named inside a batch must add up to the batch itself — name all of them, or none.',
      path: ['units'],
    },
  )
  .refine(
    (row) => {
      const labels = (row.units ?? [])
        .map((unit) => unit.label?.trim().toLowerCase())
        .filter((label): label is string => Boolean(label));
      return new Set(labels).size === labels.length;
    },
    {
      message: 'Two units of one batch cannot share a label — a label is a physical tag.',
      path: ['units'],
    },
  )
  .refine(
    (row) => {
      // The same roll cannot be topped up twice on one receipt; the two rows
      // would be indistinguishable and the user meant a single number.
      const ids = (row.units ?? [])
        .map((unit) => unit.batchUnitId)
        .filter((id): id is string => Boolean(id));
      return new Set(ids).size === ids.length;
    },
    {
      message: 'The same unit is listed twice in this batch — combine the quantities.',
      path: ['units'],
    },
  )
  .refine((row) => row.batchId || !(row.units ?? []).some((unit) => unit.batchUnitId), {
    message: 'A batch being created has no existing units to add to.',
    path: ['units'],
  })
  .refine((row) => Boolean(row.batchId) !== Boolean(row.batchReference?.trim()), {
    message: 'A batch row is either an existing batch or a new one, not both and not neither.',
    path: ['batchId'],
  })
  .refine(
    (row) =>
      !row.batchId ||
      (row.manufacturerBatch == null &&
        row.manufacturedDate == null &&
        row.expiryDate == null &&
        row.sellingPrice == null &&
        row.mrp == null),
    {
      message:
        'A batch that already exists cannot be restamped here — clear its details, or name a new batch instead.',
      path: ['manufacturerBatch'],
    },
  );

export type JobReceiptOutputBatchInput = z.infer<typeof outputBatchAllocationSchema>;

/** Allocated total, at the columns' own precision. */
function allocated(rows: readonly JobReceiptOutputBatchInput[] | undefined): number {
  return (rows ?? []).reduce((sum, row) => sum + row.qty, 0);
}

/** The same batch twice in one place is either a typo or two rows that should
 * have been one — both are better refused than silently summed. */
function hasDuplicateBatch(...groups: (readonly JobReceiptOutputBatchInput[] | undefined)[]) {
  const seen = new Set<string>();
  for (const group of groups) {
    for (const row of group ?? []) {
      if (!row.batchId) continue;
      if (seen.has(row.batchId)) return true;
      seen.add(row.batchId);
    }
  }
  return false;
}

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

    /**
     * 🔴 The label the accepted goods will carry from here on. What the processor
     * returns is a physically NEW thing with no number of its own, so unless
     * somebody names it here the batch has nothing to show in the next step's
     * picker — `batchNumber` is internal and never rendered (2026-08-14).
     *
     * Required only for batch-tracked items, and enforced in `createBatch` rather
     * than here: whether it is needed depends on the ITEM, which this schema
     * cannot see.
     */
    batchReference: z.string().trim().max(100).nullable().optional(),
    /** The same, for the rework batch — it is a separate batch with a separate
     * life, so it cannot share the accepted batch's label. */
    reworkBatchReference: z.string().trim().max(100).nullable().optional(),

    /**
     * 🔴 WHERE THE ACCEPTED GOODS ACTUALLY LAND, and there may be more than one
     * place (2026-08-21). A dyer returning three dye lots in one consignment is
     * three batches, not one; forcing them into one label loses the separation
     * the lots were kept in.
     *
     * Omitted, the two scalars above still apply and one batch takes the whole
     * accepted quantity — which is exactly what every pre-2026-08-21 client
     * sends, so the old dialog keeps working unchanged.
     */
    batches: z.array(outputBatchAllocationSchema).optional(),
    /** The same for rework. 🔴 A DIFFERENT set of batches, always: rework keeps
     * its own so the re-issue can send back only the pieces that failed. */
    reworkBatches: z.array(outputBatchAllocationSchema).optional(),

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
  )
  /**
   * 🔴 THE ALLOCATION MUST ACCOUNT FOR THE WHOLE QUANTITY.
   *
   * Under-allocating posts less stock than the receipt claims came back;
   * over-allocating posts stock nobody received. Neither is recoverable from the
   * document afterwards, because the ledger would be right about itself and
   * wrong about the paperwork.
   *
   * Compared at four decimals, the columns' own precision — an exact float test
   * would reject 3 × 33.3333 for being a billionth off.
   */
  .refine(
    (row) =>
      !row.batches?.length || Math.abs(allocated(row.batches) - (row.acceptedQty ?? 0)) < 0.00005,
    {
      message: 'The batches must add up to the accepted quantity.',
      path: ['batches'],
    },
  )
  .refine(
    (row) =>
      !row.reworkBatches?.length ||
      Math.abs(allocated(row.reworkBatches) - (row.reworkQty ?? 0)) < 0.00005,
    {
      message: 'The rework batches must add up to the rework quantity.',
      path: ['reworkBatches'],
    },
  )
  /** Scrap and returned goods never get a batch — scrap's cost stays inside the
   * batch that survived (§5.5) and returned goods never entered stock at all
   * (§6.4). A row that allocates batches while claiming neither accepted nor
   * rework quantity is asking for stock to be created out of nothing. */
  .refine((row) => (row.acceptedQty ?? 0) > 0 || !row.batches?.length, {
    message: 'A returned item with no accepted quantity cannot name accepted batches.',
    path: ['batches'],
  })
  .refine((row) => (row.reworkQty ?? 0) > 0 || !row.reworkBatches?.length, {
    message: 'A returned item with no rework quantity cannot name rework batches.',
    path: ['reworkBatches'],
  })
  /** 🔴 One batch may not appear twice, and the accepted and rework sides may
   * never share one. Rework merged into the accepted batch loses the piece count
   * it has to be measured by, and the re-issue would have no way to send back
   * only what failed. */
  .refine((row) => !hasDuplicateBatch(row.batches, row.reworkBatches), {
    message:
      'The same batch is named more than once. Accepted and rework goods must go to different batches.',
    path: ['batches'],
  });

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

    /** The single-output form's copy of the same two fields — with no `outputs`
     * grid to carry them, the derived output takes them from the header. Ignored
     * whenever `outputs` is supplied, since each row then names its own. */
    batchReference: z.string().trim().max(100).nullable().optional(),
    reworkBatchReference: z.string().trim().max(100).nullable().optional(),

    remarks: z.string().trim().max(2000).nullable().optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
  }),
);

export type CreateJobReceiptInput = z.infer<typeof createJobReceiptSchema>;

/**
 * Cancelling a receipt. Same rule as an issue: reversing entries, never a delete.
 * Harder to justify and therefore harder to do — a receipt has already created
 * batches, and those batches may have been issued onward.
 */
export const cancelJobReceiptSchema = openApiRegistry.register(
  'CancelJobReceiptRequest',
  z.object({
    reason: z.string().trim().min(1, 'Say why this receipt is being cancelled.').max(2000),
  }),
);

export type CancelJobReceiptInput = z.infer<typeof cancelJobReceiptSchema>;
