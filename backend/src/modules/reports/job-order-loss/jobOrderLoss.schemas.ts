import { z } from 'zod';

export const jobOrderLossQuerySchema = z.object({
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  itemName: z.string().trim().optional(),
  processorName: z.string().trim().optional(),
  jobOrderNumber: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).optional(),
  perPage: z.coerce.number().int().min(1).max(100).optional(),
});

export type JobOrderLossQuery = z.infer<typeof jobOrderLossQuerySchema>;

/** One challan line's write-off — what a completed or short-closed step left at the processor. */
export interface JobOrderLossRow {
  /** The challan line written off — unique per row. */
  id: string;
  writtenOffAt: Date;
  jobOrderId: string;
  jobOrderNumber: string;
  stepSeq: number;
  processName: string;
  /** completed | short_closed — which decision wrote it off. */
  closedAs: string;
  jobIssueId: string | null;
  challanNumber: string | null;
  processorName: string | null;
  itemId: string;
  itemName: string;
  uomName: string | null;
  batchNumber: string | null;
  qty: number;
  value: number;
  reason: string | null;
}

export interface PaginatedJobOrderLossResponse {
  results: JobOrderLossRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  /** Quantities are left un-summed: metres, cones and pieces do not add up. */
  grandTotalValue: number;
}
