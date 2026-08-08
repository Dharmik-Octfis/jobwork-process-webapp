import { z } from 'zod';
import { paginatedSchema, type Paginated } from '../../../lib/pagination';
import {
  decimalString,
  itemRefSchema,
  namedRefSchema,
  stepItemRowSchema,
  uomRefSchema,
  type StepItemRow,
} from '../jobwork.schemas';

/**
 * Job Orders — one run of work.
 *
 * 🔴 `status` is read-only everywhere on the client. It is recomputed on the
 * server from the issues and receipts underneath the order; there is no control
 * that sets it and there must not be, or the list and the Overview page start
 * telling two different stories about the same order.
 */

export const jobOrderStepSchema = z.object({
  id: z.string(),
  seq: z.number(),
  processId: z.string(),
  processNameSnapshot: z.string(),
  processorType: z.string(),
  processorId: z.string().nullable(),
  processorNameSnapshot: z.string().nullable(),
  workCentreLocationId: z.string().nullable(),
  rate: decimalString,
  rateBasis: z.string().nullable(),
  issueItemId: z.string().nullable(),
  issueUomId: z.string().nullable(),
  receiveItemId: z.string().nullable(),
  receiveUomId: z.string().nullable(),
  expectedYield: decimalString,
  tolerancePct: decimalString,
  plannedInputQty: decimalString,
  status: z.string(),
  remarks: z.string().nullable(),

  /** 🔴 What this step consumes and produces (§5.7) — several of each, in
   * several units. The four scalars above are the principal input and primary
   * output, kept until Migration B. */
  inputs: z.array(stepItemRowSchema).default([]),
  outputs: z.array(stepItemRowSchema).default([]),

  process: z
    .object({
      id: z.string(),
      name: z.string(),
      code: z.string().nullable(),
      preservesPackaging: z.boolean(),
      requiresSingleLot: z.boolean(),
    })
    .optional(),
  issueItem: itemRefSchema.nullable().optional(),
  receiveItem: itemRefSchema.nullable().optional(),
  issueUom: uomRefSchema.nullable().optional(),
  receiveUom: uomRefSchema.nullable().optional(),
  workCentre: namedRefSchema.nullable().optional(),
});

export type JobOrderStep = z.infer<typeof jobOrderStepSchema>;

export const jobOrderSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  jobOrderNumber: z.string(),
  orderDate: z.string(),
  targetDate: z.string().nullable(),
  /** 🔴 CALC+ since 2026-08-07 — derived by the server from step 1's first
   * consumed row, never sent. A step consumes a SET of items, so one item and one
   * quantity on the header could only ever name one of them. Nullable: a step
   * that lists nothing yet has nothing to derive from. */
  inputItemId: z.string().nullable(),
  inputUomId: z.string().nullable(),
  inputQty: z.union([z.string(), z.number()]).nullable(),
  routeId: z.string().nullable(),
  routeNameSnapshot: z.string().nullable(),
  ownership: z.string(),
  ownerPartyId: z.string().nullable(),
  status: z.string(),
  remarks: z.string().nullable(),
  steps: z.array(jobOrderStepSchema).default([]),
  inputItem: itemRefSchema.nullable().optional(),
  inputUom: uomRefSchema.nullable().optional(),
  route: namedRefSchema.nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export type JobOrder = z.infer<typeof jobOrderSchema>;

/** Per-step derived totals from the Overview endpoint. Strings, because they are
 * Decimals — see `decimalString`. */
export const stepTotalsSchema = z.object({
  issuedQty: z.string(),
  /** How much of the issued material has been accounted for, in the INPUT's
   * unit — the only figure comparable with `issuedQty` when the item changes. */
  consumedQty: z.string(),
  receivedQty: z.string(),
  acceptedQty: z.string(),
  reworkQty: z.string(),
  scrapQty: z.string(),
  returnedQty: z.string(),
  outstandingQty: z.string(),
  issueCount: z.number(),
  receiptCount: z.number(),
});

/**
 * 🔴 THE NUMBERS THE OVERVIEW ACTUALLY RENDERS — per item, each in its own unit
 * (§5.7, §6.5).
 *
 * `planned: false` marks a row nobody listed on the step: an item that was
 * issued or came back anyway. Rework is the everyday case — it sends the OUTPUT
 * item back out against the same step — so the page labels those rows rather
 * than treating them as anomalies.
 */
export const stepItemTotalsSchema = z.object({
  itemId: z.string(),
  itemName: z.string(),
  uomSymbol: z.string().nullable(),
  planned: z.boolean(),
  fromStock: z.boolean(),
  issuedQty: z.string(),
});

export const stepOutputTotalsSchema = z.object({
  itemId: z.string(),
  itemName: z.string(),
  uomSymbol: z.string().nullable(),
  planned: z.boolean(),
  isPrimary: z.boolean(),
  receivedQty: z.string(),
});

export type StepItemTotals = z.infer<typeof stepItemTotalsSchema>;
export type StepOutputTotals = z.infer<typeof stepOutputTotalsSchema>;

export const overviewStepSchema = jobOrderStepSchema.extend({
  totals: stepTotalsSchema,
  itemTotals: z.object({
    inputs: z.array(stepItemTotalsSchema).default([]),
    outputs: z.array(stepOutputTotalsSchema).default([]),
  }),
  availableQty: z.string(),
  canIssue: z.boolean(),
  /** Why the Issue button is off, in words. Null when it is on. */
  blockedReason: z.string().nullable().default(null),
  canReceive: z.boolean(),
});

export type OverviewStep = z.infer<typeof overviewStepSchema>;

export const jobOrderOverviewSchema = z.object({
  jobOrder: jobOrderSchema,
  lots: z.array(
    z.object({
      id: z.string(),
      lotNumber: z.string(),
      supplierLotRef: z.string().nullable(),
      itemId: z.string(),
    }),
  ),
  summary: z.object({
    issuedQty: z.string(),
    inHandQty: z.string(),
    inHandValue: z.string(),
    wastagePct: z.string().nullable(),
    costPerUnit: z.string().nullable(),
  }),
  steps: z.array(overviewStepSchema),
});

export type JobOrderOverviewData = z.infer<typeof jobOrderOverviewSchema>;

export interface JobOrderStepData {
  processId: string;
  processorType?: string;
  processorId?: string | null;
  workCentreLocationId?: string | null;
  rate?: number | null;
  rateBasis?: string | null;
  /**
   * 🔴 The two lists (§5.7).
   *
   * Step 1's copy of the ORDER's item is not sent: the server prepends it
   * (`resolveStepRows`), so putting it here as well would be the same fact typed
   * twice, and the two could disagree the moment somebody changes the header.
   */
  inputs?: StepItemRow[];
  outputs?: StepItemRow[];
  expectedYield?: number | null;
  tolerancePct?: number | null;
  plannedInputQty?: number | null;
  remarks?: string | null;
}

/**
 * 🔴 NO ITEM, NO QUANTITY, NO MATERIAL IN.
 *
 * The header lost its item and quantity because a step consumes a SET of items —
 * one pair on the document that owns all of them could only ever describe one,
 * and would be the field everybody then trusted. What the order runs on is step
 * 1's CONSUMES list.
 *
 * Material In went with them: stock now comes from Purchase Received and Opening
 * Stock (`docs/PURCHASE_RECEIVED_AND_ITEMS_SPEC.md` §D3). Until those ship a job
 * order is a plan, and there may be nothing to issue against it yet.
 */
export interface CreateJobOrderData {
  /** Omitted, the server takes the next number in the series. Sent, it is the
   * number the user typed over the offered one — create-only, because by edit
   * time it is printed on the challans raised against the order. */
  jobOrderNumber?: string;
  orderDate?: string;
  targetDate?: string | null;
  routeId?: string | null;
  ownership?: string;
  ownerPartyId?: string | null;
  steps: JobOrderStepData[];
  remarks?: string | null;
  customFields?: Record<string, unknown>;
}

export type UpdateJobOrderData = Omit<CreateJobOrderData, 'jobOrderNumber'>;

export const jobOrdersPageSchema = paginatedSchema(jobOrderSchema);
export type JobOrdersPage = Paginated<JobOrder>;
