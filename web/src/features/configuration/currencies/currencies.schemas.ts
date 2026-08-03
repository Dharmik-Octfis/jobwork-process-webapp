import { z } from 'zod';

export const createCurrencySchema = z.object({
  currencyCode: z
    .string()
    .min(1, 'Currency code is required')
    .max(10, 'Currency code must be 10 characters or less'),
  currencyName: z
    .string()
    .min(1, 'Currency name is required')
    .max(100, 'Currency name must be 100 characters or less'),
  symbol: z.string().min(1, 'Symbol is required').max(10, 'Symbol must be 10 characters or less'),
  decimalPlaces: z.coerce
    .number()
    .int()
    .min(0, 'Decimal places cannot be negative')
    .max(6, 'Decimal places cannot exceed 6')
    .default(2),
  format: z.string().min(1, 'Format is required'),
  exchangeRate: z.coerce.number().min(0, 'Exchange rate must be positive').default(1),
  isActive: z.boolean().optional().default(true),
});

export type CreateCurrencyData = z.output<typeof createCurrencySchema>;
export type CreateCurrencyFormData = z.input<typeof createCurrencySchema>;
export type UpdateCurrencyData = Partial<CreateCurrencyData>;

export interface Currency {
  id: string;
  organizationId: string;
  currencyCode: string;
  currencyName: string;
  symbol: string;
  decimalPlaces: number;
  format: string;
  exchangeRate: number;
  isDeleted: boolean;
  isActive: boolean;
  isBaseCurrency: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Already resolved to the actor's name **in this organization** — not their
   * account name, which is deliberately different since per-org profiles landed.
   * Never blank: "System" for a migration/seed write, "Support" for an actor who is
   * not a member of this org.
   */
  createdByName?: string | null;
  updatedByName?: string | null;
}
