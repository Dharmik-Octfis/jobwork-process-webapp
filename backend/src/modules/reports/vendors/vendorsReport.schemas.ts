import { z } from 'zod';
import { listQuerySchema } from '../../../lib/pagination.ts';

export const vendorsReportQuerySchema = listQuerySchema.extend({
  contactNumber: z.string().optional(),
  companyName: z.string().optional(),
  status: z.string().optional(),
  vendorType: z.string().optional(),
});
