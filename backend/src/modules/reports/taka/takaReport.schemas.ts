import { z } from 'zod';
import { listQuerySchema } from '../../../lib/pagination.ts';

export const takaReportQuerySchema = listQuerySchema.extend({
  itemName: z.string().optional(),
  locationName: z.string().optional(),
  batchText: z.string().optional(),
  onlyAtJobWorkers: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  asOnDate: z.string().datetime().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  minAgeDays: z.coerce.number().min(0).optional(),
});

export type TakaReportQuery = z.infer<typeof takaReportQuerySchema>;

export type TakaReportRow = {
  id: string; // batch_unit_id (or batch_id + ':untagged') + ':' + location_id
  label: string; // batch_units.label or '(untagged)'
  itemName: string;
  batch: string;
  locationName: string;
  qty: number;
  receivedOn: Date | null;
  daysAtLocation: number | null;
  sourceDocType: string | null;
  sourceDocNumber: string | null;
  sourceDocId: string | null;
  
  // hidden columns
  receivedQty: number | null;
  challanNumber: string | null;
  value: number;
};

export type PaginatedTakaReportResponse = {
  results: TakaReportRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  grandTotalValue: number;
};
