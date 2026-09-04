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
  /** 🔴 No `batchNumber` (2026-08-14) — it is an internal key and the server no
   * longer sends it. `id` is the handle; `supplierBatchRef` is the label. */
  batch: z.object({ id: z.string(), supplierBatchRef: z.string().nullable() }).optional(),
  batchUnitId: z.string().nullable().optional(),
  /**
   * 🔴 WHICH PACKAGE this line sent, and it is what the CHALLAN PRINTS.
   *
   * The label is what is written on the roll's own tag — the one thing the
   * processor at the other end can match the goods against. Null on a line
   * drawing the batch's untagged remainder, and on every line written before the
   * level existed; the challan prints an em dash there rather than a blank cell.
   */
  batchUnit: z.object({ id: z.string(), seq: z.number(), label: z.string() }).nullable().optional(),
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
  /** Omitted for an UNTRACKED item — it gets no picker, and the server allocates
   * FIFO out of the dispatch site's oldest stock. Required for a batch-tracked
   * item, which the server refuses without. */
  batchId?: string | null;
  /**
   * 🔴 WHICH PACKAGE of that batch — a taka, roll or bale — when the org runs a
   * unit level and the user ticked one.
   *
   * Omitted, the line draws on the batch's UNTAGGED remainder, which is what
   * every line meant before the level existed. Three ticked rolls are three
   * lines, exactly as three batches are.
   *
   * The quantity that comes with it is the package's OWN balance: a package is
   * atomic at issue, and the server refuses a line saying otherwise rather than
   * rounding it to fit.
   */
  batchUnitId?: string | null;
  /** Which godown this row came from. The picker offers one row per (batch,
   * godown) because a challan may draw from a whole dispatch site. Omitted, the
   * header's dispatch location is assumed — which is what a single-godown site
   * always means. */
  sourceLocationId?: string | null;
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
  /**
   * Which button was pressed — a MODE, not a status. `status` is derived by the
   * server from the receipts underneath and is never accepted from here; this
   * only chooses between parking the challan and sending it.
   *
   * Omitted means issue, so nothing that predates drafts changes behaviour.
   */
  saveAsDraft?: boolean;
}

export const jobIssuesPageSchema = paginatedSchema(jobIssueSchema);
export type JobIssuesPage = Paginated<JobIssue>;
