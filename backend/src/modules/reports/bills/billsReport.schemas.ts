import { z } from 'zod';
import { listQuerySchema } from '../../../lib/pagination.ts';

export const billsReportQuerySchema = listQuerySchema.extend({
  vendorId: z.string().optional(),
  status: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  billNumber: z.string().optional(),
  vendorName: z.string().optional(),
  locationName: z.string().optional(),
  paymentTerms: z.string().optional(),
  fromDeliveryDate: z.string().optional(),
  toDeliveryDate: z.string().optional(),
  total: z.string().optional(),
  billCustomFields: z.record(z.string(), z.unknown()).optional(),
});
