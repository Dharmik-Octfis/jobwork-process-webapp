import { z } from 'zod';

export const createPaymentTermSchema = z.object({
  termName: z.string().min(1, 'Term name is required').max(100),
  dueAfterDays: z.number().int().min(0, 'Due after days must be 0 or more').max(365),
});

export type CreatePaymentTermData = z.infer<typeof createPaymentTermSchema>;

export type CreatePaymentTermInput = z.infer<typeof createPaymentTermSchema>;
