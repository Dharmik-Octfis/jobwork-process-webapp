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
 * 🔴 `mode` is READ-ONLY on the client. `Process.preservesPackaging` decides it
 * (§6.1): dyeing returns the same roll so takas can be received individually,
 * cutting destroys the roll so only a bulk quantity exists. It arrives from the
 * prefill endpoint alongside the sentence explaining it — a disabled toggle would
 * raise the question and answer nothing.
 */

export const jobReceiptLineSchema = z.object({
  id: z.string(),
  jobIssueId: z.string().nullable(),
  jobIssueLineId: z.string().nullable(),
  parentPackageId: z.string().nullable(),
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
  parentPackage: z
    .object({
      id: z.string(),
      packageNumber: z.number(),
      label: z.string().nullable(),
      qty: z.union([z.string(), z.number()]),
    })
    .nullable()
    .optional(),
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
        reason: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
        responsibility: z.string().nullable().optional(),
        outputBatch: z.object({ id: z.string(), batchNumber: z.string() }).nullable().optional(),
        reworkBatch: z.object({ id: z.string(), batchNumber: z.string() }).nullable().optional(),
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
  outputBatch: z.object({ id: z.string(), batchNumber: z.string() }).nullable().optional(),
  reworkBatch: z.object({ id: z.string(), batchNumber: z.string() }).nullable().optional(),
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
    process: z.object({ id: z.string(), name: z.string(), preservesPackaging: z.boolean() }),
    jobOrder: z.object({ id: z.string(), jobOrderNumber: z.string(), ownership: z.string() }),
    /** 🔴 What the step plans to consume and produce — the only source for the
     * dialog's item and unit labels since Migration B dropped the scalars. */
    inputs: z.array(stepItemRowSchema).default([]),
    outputs: z.array(stepItemRowSchema).default([]),
  }),
  mode: z.string(),
  /** Why the mode is what it is, in words. Shown instead of a disabled control. */
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
      batchNumber: z.string(),
      packageLabel: z.string().nullable(),
      packageNumber: z.number().nullable(),
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
  parentPackageId?: string | null;
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
  remarks?: string | null;
  customFields?: Record<string, unknown>;
}

export const jobReceiptsPageSchema = paginatedSchema(jobReceiptSchema);
export type JobReceiptsPage = Paginated<JobReceipt>;
