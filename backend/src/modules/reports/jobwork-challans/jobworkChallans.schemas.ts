import { z } from 'zod';
import { listQuerySchema } from '../../../lib/pagination.ts';

export const jobworkChallansQuerySchema = listQuerySchema.extend({
  processorName: z.string().optional(),
  processName: z.string().optional(),
  jobOrderNumber: z.string().optional(),
  itemName: z.string().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  openOnly: z
    .string()
    .optional()
    .transform((val) => val !== 'false'), // ON by default
  minAgeDays: z.coerce.number().min(0).optional(),
});

export type JobworkChallansQuery = z.infer<typeof jobworkChallansQuerySchema>;

export type JobworkChallanRow = {
  id: string; // job_issue.id
  challanNumber: string;
  issueDate: Date;
  processorName: string;
  process: string;
  jobOrderNumber: string;
  jobOrderId: string;
  items: string; // single item + UOM, or "N items"
  issuedQty: number;
  receivedQty: number;
  acceptedQty: number;
  reworkQty: number;
  scrapQty: number;
  returnedQty: number;
  pendingQty: number;
  daysOutstanding: number | null;
  status: string;
  
  // hidden columns
  processCharge: number;
  attempt: string | null;
  reason: string | null;
  transporter: string | null;
};

export type PaginatedJobworkChallansResponse = {
  results: JobworkChallanRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  grandTotalValue?: number;
};
