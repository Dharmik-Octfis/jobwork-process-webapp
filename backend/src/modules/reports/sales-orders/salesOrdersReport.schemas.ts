import { z } from 'zod';

export const salesOrdersReportQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  customerId: z.string().uuid().optional(),
  status: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  soNumber: z.string().optional(),
  customerName: z.string().optional(),
  paymentTerms: z.string().optional(),
  minTotal: z.coerce.number().optional(),
  maxTotal: z.coerce.number().optional(),
  salesOrderCustomFields: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      try {
        return JSON.parse(val) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    }),
});
