import { z } from 'zod';
import { listQuerySchema } from '../../../lib/pagination.ts';

export const customersReportQuerySchema = listQuerySchema.extend({
  contactNumber: z.string().optional(),
  companyName: z.string().optional(),
  status: z.string().optional(),
  customerType: z.string().optional(),
});
