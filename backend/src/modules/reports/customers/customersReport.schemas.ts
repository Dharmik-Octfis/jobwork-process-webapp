import { z } from 'zod';
import { reportListQuerySchema } from '../../../lib/pagination.ts';

export const customersReportQuerySchema = reportListQuerySchema.extend({
  contactNumber: z.string().optional(),
  companyName: z.string().optional(),
  status: z.string().optional(),
  customerType: z.string().optional(),
});
