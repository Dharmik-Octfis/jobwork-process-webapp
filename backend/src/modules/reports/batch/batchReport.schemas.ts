import { z } from 'zod';

export const batchReportQuerySchema = z.object({
  itemName: z.string().trim().optional(),
  locationName: z.string().trim().optional(),
  batchText: z.string().trim().optional(),
  state: z.string().trim().optional(),
  asOnDate: z.string().datetime().optional(),
  minAgeDays: z.coerce.number().int().min(0).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export type BatchReportQuery = z.infer<typeof batchReportQuerySchema>;

export interface BatchReportRow {
  /** The batch and location combination — unique per row. */
  id: string;
  batch: string | null;
  itemName: string;
  locationName: string;
  qty: number;
  takaCount: number | null;
  untaggedQty: number | null;
  receivedOn: Date | null;
  ageDays: number | null;
  sourceDocType: string | null;
  sourceDocNumber: string | null;
  sourceDocId: string | null;
  state: string;
  batchNumber: string;
  value: number;
  avgRate: number;
  parentBatches: string | null;
}

export interface PaginatedBatchReportResponse {
  results: BatchReportRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  grandTotalValue: number;
}
