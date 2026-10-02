import { z } from 'zod';
import { listQuerySchema } from '../../../lib/pagination.ts';

export const purchaseOrdersReportQuerySchema = listQuerySchema.extend({
  vendorId: z.string().optional(),
  status: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  deliveryType: z.string().optional(),
  poNumber: z.string().optional(),
  vendorName: z.string().optional(),
  purchaseOrderCustomFields: z.record(z.string(), z.unknown()).optional(),
});
