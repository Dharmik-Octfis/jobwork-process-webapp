import { z } from 'zod';

export const stockMovementQuerySchema = z.object({
  itemId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  movementType: z.enum(['all', 'inward', 'outward']).optional().default('all'),
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export type StockMovementQuery = z.infer<typeof stockMovementQuerySchema>;

export interface StockMovementRow {
  id: string;
  transactionDate: Date;
  transactionNumber: string;
  itemId: string;
  itemName: string;
  createdAt: Date;
  transactionType: string;
  movementType: 'Inward' | 'Outward';
  source: string;
  destination: string;
  quantity: number;
}

export interface PaginatedStockMovementResponse {
  results: StockMovementRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  grandTotalQuantity: number;
}
