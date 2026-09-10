import { z } from 'zod';

export const inventoryValuationQuerySchema = z.object({
  asOfDate: z.string().optional(),
  stockAvailability: z.enum(['none', 'gt', 'lte', 'lt', 'eq', 'neq']).optional().default('none'),
  status: z.enum(['all', 'active', 'inactive']).optional().default('all'),
  // Pagination could be added here if needed
});

export type InventoryValuationQuery = z.infer<typeof inventoryValuationQuerySchema>;

export interface InventoryValuationRow {
  itemId: string;
  itemName: string;
  categoryName: string | null;
  uomName: string | null;
  stockOnHand: number;
  inventoryAssetValue: number;
}
