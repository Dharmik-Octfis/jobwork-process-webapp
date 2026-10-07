import { z } from 'zod';
import { listQuerySchema } from '../../../lib/pagination.ts';

export const jobOrdersReportQuerySchema = listQuerySchema.extend({
  jobOrderNumber: z.string().optional(),
  processorName: z.string().optional(),
  processName: z.string().optional(),
  status: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  targetDateFrom: z.string().optional(),
  targetDateTo: z.string().optional(),
  routeName: z.string().optional(),
  ownership: z.string().optional(),
  processorType: z.string().optional(),
  jobOrderCustomFields: z.record(z.string(), z.unknown()).optional(),
});
