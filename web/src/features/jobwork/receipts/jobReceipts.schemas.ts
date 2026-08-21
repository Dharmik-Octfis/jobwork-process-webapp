import { z } from 'zod';
import { paginatedSchema, type Paginated } from '../../../lib/pagination';
import {
  decimalString,
  itemRefSchema,
  namedRefSchema,
  stepItemRowSchema,
  uomRefSchema,
} from '../jobwork.schemas';

/**
 * Receipts — goods back.
 *
 * ⚠️ `mode` (unit_wise | bulk) and `Process.preservesPackaging` went with
 * package-level tracking on 2026-08-12. Every receipt is a quantity against a
 * batch, so there is no second shape left to choose between.
 */

export const jobReceiptLineSchema = z.object({
  id: z.string(),
  jobIssueId: z.string().nullable(),
  jobIssueLineId: z.string().nullable(),
  issuedQty: z.union([z.string(), z.number()]),
  receivedQty: z.union([z.string(), z.number()]),
  acceptedQty: z.union([z.string(), z.number()]),
  reworkQty: z.union([z.string(), z.number()]),
  scrapQty: z.union([z.string(), z.number()]),
  returnedQty: z.union([z.string(), z.number()]),
  reasonId: z.string().nullable(),
  responsibility: z.string().nullable(),
  remarks: z.string().nullable(),
  reason: namedRefSchema.nullable().optional(),
  jobIssue: z.object({ id: z.string(), challanNumber: z.string() }).nullable().optional(),
  /** The challan line this row closes, and therefore which item it consumed. */
  jobIssueLine: z
    .object({ id: z.string(), item: z.object({ id: z.string(), name: z.string() }).nullable() })
    .nullable()
    .optional(),
});

export type JobReceiptLine = z.infer<typeof jobReceiptLineSchema>;

export const jobReceiptSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  jobOrderId: z.string(),
  jobOrderStepId: z.string(),
  receiptNumber: z.string(),
  receiptDate: z.string(),
  processorType: z.string(),
  processorId: z.string().nullable(),
  processorNameSnapshot: z.string().nullable(),
  locationId: z.string(),
  outputBatchId: z.string().nullable(),
  reworkBatchId: z.string().nullable(),
  totalIssuedQty: z.union([z.string(), z.number()]),
  totalReceivedQty: z.union([z.string(), z.number()]),
  totalAcceptedQty: z.union([z.string(), z.number()]),
  totalReworkQty: z.union([z.string(), z.number()]),
  totalScrapQty: z.union([z.string(), z.number()]),
  totalReturnedQty: z.union([z.string(), z.number()]),
  status: z.string(),
  remarks: z.string().nullable(),
  lines: z.array(jobReceiptLineSchema).default([]),

  /**
   * 🔴 WHAT CAME BACK, one row per item (§5.7) — and the only place the
   * disposition now lives.
   *
   * `lines` above is the CONSUMED side: how much of each challan line this
   * receipt accounts for. At batch level its disposition columns are all zero, so
   * a screen reading them shows a receipt where nothing was accepted. These are
   * the rows to render.
   */
  outputs: z
    .array(
      z.object({
        id: z.string(),
        seq: z.number(),
        itemId: z.string(),
        receivedQty: decimalString,
        acceptedQty: decimalString,
        reworkQty: decimalString,
        scrapQty: decimalString,
        isPrimary: z.boolean(),
        item: itemRefSchema.nullable().optional(),
        uom: uomRefSchema.nullable().optional(),
        /** Older receipts only — the gate types free text now, which lands in
         * `remarks`. Both are rendered under one Reason column. */
        reason: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
        remarks: z.string().nullable().optional(),
        responsibility: z.string().nullable().optional(),
        outputBatch: z
          .object({ id: z.string(), supplierBatchRef: z.string().nullable() })
          .nullable()
          .optional(),
        reworkBatch: z
          .object({ id: z.string(), supplierBatchRef: z.string().nullable() })
          .nullable()
          .optional(),
        /** 🔴 The complete list. `outputBatch` / `reworkBatch` above name only the
         * FIRST of each kind, which is all there was before a row could land in
         * several batches — render these. */
        batches: z
          .array(
            z.object({
              id: z.string(),
              kind: z.enum(['accepted', 'rework']),
              qty: decimalString,
              /** False when this receipt added to a batch that already existed —
               * the second half of a split delivery, not a new lot. */
              isNewBatch: z.boolean(),
              batch: z.object({ id: z.string(), supplierBatchRef: z.string().nullable() }),
            }),
          )
          .default([]),
      }),
    )
    .default([]),

  jobOrder: z
    .object({ id: z.string(), jobOrderNumber: z.string(), ownership: z.string() })
    .optional(),
  step: z
    .object({
      id: z.string(),
      seq: z.number(),
      processNameSnapshot: z.string(),
      expectedYield: decimalString,
      rate: decimalString,
      rateBasis: z.string().nullable(),
    })
    .optional(),
  location: namedRefSchema.nullable().optional(),
  outputBatch: z
    .object({ id: z.string(), supplierBatchRef: z.string().nullable() })
    .nullable()
    .optional(),
  reworkBatch: z
    .object({ id: z.string(), supplierBatchRef: z.string().nullable() })
    .nullable()
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export type JobReceipt = z.infer<typeof jobReceiptSchema>;

/** The dialog's opening state — one request, so the mode, the open challans and
 * the taka rows all describe the same moment. */
export const receivePrefillSchema = z.object({
  step: z.object({
    id: z.string(),
    seq: z.number(),
    processNameSnapshot: z.string(),
    jobOrderId: z.string(),
    expectedYield: decimalString,
    rate: decimalString,
    rateBasis: z.string().nullable(),
    process: z.object({ id: z.string(), name: z.string() }),
    jobOrder: z.object({ id: z.string(), jobOrderNumber: z.string(), ownership: z.string() }),
    /** 🔴 What the step plans to consume and produce — the only source for the
     * dialog's item and unit labels since Migration B dropped the scalars. */
    inputs: z.array(stepItemRowSchema).default([]),
    outputs: z.array(stepItemRowSchema).default([]),
  }),
  issues: z.array(
    z.object({
      id: z.string(),
      challanNumber: z.string(),
      issueDate: z.string(),
      totalQty: z.string(),
      isRework: z.boolean(),
      attemptNo: z.number(),
    }),
  ),
  lines: z.array(
    z.object({
      jobIssueId: z.string(),
      challanNumber: z.string(),
      jobIssueLineId: z.string(),
      /** 🔴 The item is on the challan LINE now (§5.7) — one challan carries
       * fabric, thread and buttons, and the consumed grid groups by it. */
      itemId: z.string().nullable(),
      itemName: z.string().nullable(),
      uomSymbol: z.string().nullable(),
      batchId: z.string(),
      /** The label, not the internal number (2026-08-14). Null for untracked
       * stock, whose batches are not meant to be identified on screen. */
      batchReference: z.string().nullable(),
      issuedQty: z.string(),
    }),
  ),
  /**
   * The returned grid's opening rows — one per item the step planned to produce.
   * 🔴 No quantities: what came back is measured at the gate, and pre-filling the
   * expectation is how an expectation gets recorded as a measurement (§6.3).
   */
  outputs: z
    .array(
      z.object({
        itemId: z.string(),
        itemName: z.string(),
        uomId: z.string().nullable(),
        uomSymbol: z.string().nullable(),
        isPrimary: z.boolean(),
        expectedQty: z.string().nullable(),
      }),
    )
    .default([]),
});

export type ReceivePrefill = z.infer<typeof receivePrefillSchema>;

export interface JobReceiptLineData {
  /** 🔴 Which item this line consumes (§5.7). Required on a bulk line whenever
   * the challans carry more than one — without it the allocation walks the open
   * lines oldest-first across every item and settles a panel receipt by eating
   * the thread. */
  itemId?: string | null;
  jobIssueId?: string | null;
  jobIssueLineId?: string | null;
  issuedQty?: number;
  receivedQty: number;
  acceptedQty?: number;
  reworkQty?: number;
  scrapQty?: number;
  returnedQty?: number;
  reasonId?: string | null;
  responsibility?: string | null;
  remarks?: string | null;
}

/** 🔴 One item that came back (§5.7). A receipt carries as many as actually did. */
export interface JobReceiptOutputData {
  itemId: string;
  receivedQty: number;
  acceptedQty?: number;
  reworkQty?: number;
  scrapQty?: number;
  returnedQty?: number;
  /** Exactly one row is the main output — it absorbs the pot less whatever the
   * by-products were given (§9.2.1). */
  isPrimary?: boolean;
  /** By-products only; null on the main output, which takes the remainder. */
  valueShare?: number | null;
  reasonId?: string | null;
  responsibility?: string | null;
  remarks?: string | null;
  /** 🔴 What the accepted goods will be called from here on. The processor returns
   * a physically new thing with no number of its own, and `batchNumber` is
   * internal and never shown — so unless it is named here the batch has nothing to
   * display in the next step's picker. Required for batch-tracked items; the
   * server enforces it, since only it knows the item's tracking mode. */
  batchReference?: string | null;
  /** The rework batch is a separate batch, so it needs its own label. */
  reworkBatchReference?: string | null;
  /**
   * 🔴 WHERE THE ACCEPTED GOODS LAND — one entry per batch. Omitted, the server
   * falls back to `batchReference` and one batch takes the whole quantity, which
   * is what this payload meant before 2026-08-21.
   */
  batches?: JobReceiptBatchAllocationData[];
  /** The same for rework, always a different set of batches. */
  reworkBatches?: JobReceiptBatchAllocationData[];
}

/** Either an existing batch to add to, or a label for a new one — never both. */
export interface JobReceiptBatchAllocationData {
  batchId?: string | null;
  batchReference?: string | null;
  qty: number;
  /**
   * 🔴 THE NEW BATCH'S OWN ATTRIBUTES — sent only beside `batchReference`, and
   * refused by the server beside a `batchId`. Receipt time is the only moment
   * anybody knows what the maker's tag says or when the dye lot was made; a batch
   * that already exists is added to, never restamped from inside a receipt.
   *
   * Omitted means "not stated", which is a different fact from zero — hence
   * `null` rather than 0 on the two prices.
   */
  manufacturerBatch?: string | null;
  /** `yyyy-mm-dd`. */
  manufacturedDate?: string | null;
  expiryDate?: string | null;
  sellingPrice?: number | null;
  mrp?: number | null;
}

export interface CreateJobReceiptData {
  jobOrderStepId: string;
  receiptDate?: string;
  issueIds: string[];
  /** @deprecated The returned set lives in `outputs`; these describe the primary
   * alone and go with Migration B. */
  outputItemId?: string | null;
  outputUomId?: string | null;
  locationId: string;
  /** The consumption side — what this receipt accounts for. */
  lines: JobReceiptLineData[];
  /** The return side. Omitted, the server derives one row from `lines`. */
  outputs?: JobReceiptOutputData[];
  /** The single-output form's copy — with no `outputs` grid to carry them, the
   * derived output takes its labels from here. */
  batchReference?: string | null;
  reworkBatchReference?: string | null;
  remarks?: string | null;
  customFields?: Record<string, unknown>;
}

export const jobReceiptsPageSchema = paginatedSchema(jobReceiptSchema);
export type JobReceiptsPage = Paginated<JobReceipt>;

/**
 * WHERE ONE BATCH IS, one row per location that still holds any of it.
 *
 * 🔴 `isExternal` is computed on the server, not inferred from the name here.
 * Goods at a processor are our stock at their location, so they arrive as a
 * balance like any other — and a total that silently includes them reads as
 * stock on hand when it is material still out at a vendor.
 */
export const batchLocationBalanceSchema = z.object({
  locationId: z.string(),
  locationName: z.string().nullable(),
  locationType: z.string().nullable(),
  isExternal: z.boolean(),
  qty: decimalString,
});

export type BatchLocationBalance = z.infer<typeof batchLocationBalanceSchema>;

export const receiptBatchOptionSchema = z.object({
  batchId: z.string(),
  supplierBatchRef: z.string().nullable(),
  manufacturerBatch: z.string().nullable(),
  createdAt: z.string(),
  manufacturedDate: z.string().nullable(),
  expiryDate: z.string().nullable(),
  /** Batch-wise pricing. Shown on an existing-batch row so the person topping it
   * up can see what the batch already carries — never restated from here. */
  sellingPrice: decimalString,
  mrp: decimalString,
  uomId: z.string().nullable(),
  source: z.enum(['this_job_order', 'other']),
  /** Across every location, internal and external. Always shown broken down. */
  totalQty: decimalString,
  internalQty: decimalString,
  externalQty: decimalString,
  byLocation: z.array(batchLocationBalanceSchema).default([]),
});

export type ReceiptBatchOption = z.infer<typeof receiptBatchOptionSchema>;

/**
 * The Receive dialog's batch picker.
 *
 * 🔴 Two groups, and the split is the whole design. `jobOrderBatches` is what
 * this job order already produced — listed always, whatever the balance and
 * wherever it sits, because the batch a follow-up delivery continues is often
 * one that has already been issued onward. `otherBatches` answers a search only,
 * so merging into an unrelated batch is deliberate rather than a mis-click.
 */
export const receiptBatchOptionsSchema = z.object({
  inventoryTracking: z.string(),
  jobOrderBatches: z.array(receiptBatchOptionSchema).default([]),
  otherBatches: z.array(receiptBatchOptionSchema).default([]),
  isOtherCapped: z.boolean().default(false),
});

export type ReceiptBatchOptions = z.infer<typeof receiptBatchOptionsSchema>;
