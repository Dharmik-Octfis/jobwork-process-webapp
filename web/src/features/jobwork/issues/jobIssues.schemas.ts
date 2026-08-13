import { z } from 'zod';
import { paginatedSchema, type Paginated } from '../../../lib/pagination';
import { decimalString, itemRefSchema, namedRefSchema, uomRefSchema } from '../jobwork.schemas';

/** Issues — the challan out. */

export const jobIssueLineSchema = z.object({
  id: z.string(),
  /** 🔴 The item is a per-line fact (§5.7) — one challan carries several, and
   * since 2026-08-12 the line is the ONLY place it lives. */
  itemId: z.string(),
  uomId: z.string().nullable().optional(),
  item: itemRefSchema.nullable().optional(),
  uom: uomRefSchema.nullable().optional(),
  batchId: z.string(),
  qty: z.union([z.string(), z.number()]),
  batch: z
    .object({ id: z.string(), batchNumber: z.string(), supplierBatchRef: z.string().nullable() })
    .optional(),
});

export type JobIssueLine = z.infer<typeof jobIssueLineSchema>;

export const jobIssueSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  jobOrderId: z.string(),
  jobOrderStepId: z.string(),
  challanNumber: z.string(),
  issueDate: z.string(),
  processorType: z.string(),
  processorId: z.string().nullable(),
  processorNameSnapshot: z.string().nullable(),
  processorAddressSnapshot: z.string().nullable(),
  processorGstinSnapshot: z.string().nullable(),
  sourceLocationId: z.string(),
  destinationLocationId: z.string(),
  isRework: z.boolean(),
  attemptNo: z.number(),
  totalQty: z.union([z.string(), z.number()]),
  toleranceOverrideReason: z.string().nullable(),
  status: z.string(),
  remarks: z.string().nullable(),
  lines: z.array(jobIssueLineSchema).default([]),

  jobOrder: z
    .object({ id: z.string(), jobOrderNumber: z.string(), ownership: z.string() })
    .optional(),
  step: z
    .object({
      id: z.string(),
      seq: z.number(),
      processNameSnapshot: z.string(),
      plannedInputQty: decimalString,
    })
    .optional(),
  sourceLocation: namedRefSchema.nullable().optional(),
  destination: namedRefSchema.nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type JobIssue = z.infer<typeof jobIssueSchema>;

export interface JobIssueLineData {
  /** 🔴 Which item this line is (§5.7). One challan carries several — the dialog
   * renders a batch picker per input item and each stamps its own id here. Omitted,
   * the server falls back to the step's principal input. */
  itemId?: string | null;
  /** ⚠️ TEMPORARY — omitted when the item has no stock on record, which is normal
   * until Purchase Received ships. The server creates a zero-valued batch for the
   * line. 🔴 Make it required again then. */
  batchId?: string | null;
  qty: number;
}

export interface CreateJobIssueData {
  jobOrderStepId: string;
  issueDate?: string;
  processorType?: string;
  processorId?: string | null;
  sourceLocationId: string;
  destinationLocationId?: string | null;
  isRework?: boolean;
  /** Only needed when the issue goes past the step's tolerance ceiling — the
   * server decides that and says so in its 400. */
  toleranceOverrideReason?: string | null;
  lines: JobIssueLineData[];
  remarks?: string | null;
}

export const jobIssuesPageSchema = paginatedSchema(jobIssueSchema);
export type JobIssuesPage = Paginated<JobIssue>;
