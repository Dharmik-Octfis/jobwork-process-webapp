import { z } from 'zod';
import { reportListQuerySchema } from '../../../lib/pagination.ts';

export const jobworkReceiptsQuerySchema = reportListQuerySchema.extend({
  processorName: z.string().optional(),
  processName: z.string().optional(),
  jobOrderNumber: z.string().optional(),
  itemName: z.string().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  minAgeDays: z.coerce.number().min(0).optional(),
  receiptNumber: z.string().optional(),
  status: z.string().optional(),
  issuedQty: z.coerce.number().optional(),
  receivedQty: z.coerce.number().optional(),
  acceptedQty: z.coerce.number().optional(),
  reworkQty: z.coerce.number().optional(),
  scrapQty: z.coerce.number().optional(),
  returnedQty: z.coerce.number().optional(),
  processChargeTotal: z.coerce.number().optional(),
});

export type JobworkReceiptsQuery = z.infer<typeof jobworkReceiptsQuerySchema>;

export type JobworkReceiptRow = {
  id: string; // job_receipt.id
  receiptNumber: string;
  receiptDate: Date;
  processorName: string;
  process: string;
  jobOrderNumber: string;
  jobOrderId: string;
  lines: {
    id: string;
    items: string;
    plannedQty: number;
    receivedQty: number;
    toBeReceivedQty: number;
  }[];
  status: string;
};

export type PaginatedJobworkReceiptsResponse = {
  results: JobworkReceiptRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  grandTotalValue?: number;
};
