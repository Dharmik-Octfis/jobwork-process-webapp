import { z } from 'zod';
import { listQuerySchema } from '../../../lib/pagination.ts';

export const jobOrdersReportQuerySchema = listQuerySchema.extend({
  jobOrderNumber: z.string().optional(),
  processorName: z.string().optional(),
  processName: z.string().optional(),
});
