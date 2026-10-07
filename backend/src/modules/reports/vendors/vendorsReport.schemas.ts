import { z } from 'zod';
import { reportListQuerySchema } from '../../../lib/pagination.ts';

export const vendorsReportQuerySchema = reportListQuerySchema.extend({
  contactNumber: z.string().optional(),
  companyName: z.string().optional(),
  status: z.string().optional(),
  vendorType: z.string().optional(),
});
