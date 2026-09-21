import { z } from 'zod';

export const stockSummaryQuerySchema = z.object({
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  mode: z.enum(['bills', 'jobwork']).optional().default('bills'),
  status: z.enum(['all', 'active', 'inactive']).optional().default('all'),
  itemName: z.string().optional(),
  categoryName: z.string().optional(),
  locationId: z.string().uuid().optional(),
  sku: z.string().optional(),
  hsnCode: z.string().optional(),
  itemCustomFields: z.record(z.string(), z.unknown()).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export type StockSummaryQuery = z.infer<typeof stockSummaryQuerySchema>;

export interface StockSummaryRow {
  itemId: string;
  itemName: string;
  sku: string | null;
  hsnCode: string | null;
  categoryName: string | null;
  uomName: string | null;
  customFields: Record<string, unknown>;
  openingStock: number;
  quantityIn: number;
  quantityOut: number;
  closingStock: number;
}

export interface PaginatedStockSummaryResponse {
  results: StockSummaryRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  grandTotalOpening: number;
  grandTotalIn: number;
  grandTotalOut: number;
  grandTotalClosing: number;
}
