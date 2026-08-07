import { z } from 'zod';
import { paginatedSchema, type Paginated } from '../../../lib/pagination';
import { decimalString, itemRefSchema, namedRefSchema, uomRefSchema } from '../jobwork.schemas';

/** Issues — the challan out. */

export const jobIssueLineSchema = z.object({
  id: z.string(),
  /** 🔴 The item is a per-line fact (§5.7) — one challan carries several. Null
   * only on rows written before Sprint 5, which the header still describes. */
  itemId: z.string().nullable().optional(),
  uomId: z.string().nullable().optional(),
  item: itemRefSchema.nullable().optional(),
  uom: uomRefSchema.nullable().optional(),
  lotId: z.string(),
  lotPackageId: z.string().nullable(),
  qty: z.union([z.string(), z.number()]),
  lot: z
    .object({ id: z.string(), lotNumber: z.string(), supplierLotRef: z.string().nullable() })
    .optional(),
  lotPackage: z
    .object({
      id: z.string(),
      packageNumber: z.number(),
      label: z.string().nullable(),
      qty: z.union([z.string(), z.number()]),
    })
    .nullable()
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
  itemId: z.string(),
  uomId: z.string().nullable(),
  isRework: z.boolean(),
  attemptNo: z.number(),
  transporterId: z.string().nullable(),
  vehicleNo: z.string().nullable(),
  lrNo: z.string().nullable(),
  lrDate: z.string().nullable(),
  ewayBillNo: z.string().nullable(),
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
  item: itemRefSchema.nullable().optional(),
  uom: uomRefSchema.nullable().optional(),
  sourceLocation: namedRefSchema.nullable().optional(),
  destination: namedRefSchema.nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export type JobIssue = z.infer<typeof jobIssueSchema>;

export interface JobIssueLineData {
  /** 🔴 Which item this line is (§5.7). One challan carries several — the dialog
   * renders a lot picker per input item and each stamps its own id here. Omitted,
   * the server falls back to the step's principal input. */
  itemId?: string | null;
  /** ⚠️ TEMPORARY — omitted when the item has no stock on record, which is normal
   * until Purchase Received ships. The server creates a zero-valued lot for the
   * line. 🔴 Make it required again then. */
  lotId?: string | null;
  lotPackageId?: string | null;
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
  transporterId?: string | null;
  vehicleNo?: string | null;
  lrNo?: string | null;
  lrDate?: string | null;
  ewayBillNo?: string | null;
  /** Only needed when the issue goes past the step's tolerance ceiling — the
   * server decides that and says so in its 400. */
  toleranceOverrideReason?: string | null;
  lines: JobIssueLineData[];
  remarks?: string | null;
  customFields?: Record<string, unknown>;
}

export const jobIssuesPageSchema = paginatedSchema(jobIssueSchema);
export type JobIssuesPage = Paginated<JobIssue>;
