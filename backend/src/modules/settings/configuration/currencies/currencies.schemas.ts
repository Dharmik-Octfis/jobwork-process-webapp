import { z } from 'zod';

export const createCurrencySchema = z.object({
  currencyCode: z.string().min(1, 'Currency code is required').max(10, 'Currency code must be 10 characters or less'),
  currencyName: z.string().min(1, 'Currency name is required').max(100, 'Currency name must be 100 characters or less'),
  symbol: z.string().min(1, 'Symbol is required').max(10, 'Symbol must be 10 characters or less'),
  decimalPlaces: z.coerce.number().int().min(0, 'Decimal places cannot be negative').max(6, 'Decimal places cannot exceed 6').default(2),
  format: z.string().min(1, 'Format is required'),
});

export const updateCurrencySchema = createCurrencySchema.partial();
