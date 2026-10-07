import { z } from 'zod';

export const inventoryValuationQuerySchema = z.object({
  asOfDate: z.string().optional(),
  stockAvailability: z.enum(['none', 'gt', 'lte', 'lt', 'eq', 'neq']).optional().default('none'),
  status: z.enum(['all', 'active', 'inactive']).optional().default('all'),
  itemName: z.string().optional(),
  categoryName: z.string().optional(),
  locationId: z.string().optional(),
  sku: z.string().optional(),
  hsnCode: z.string().optional(),
  itemCustomFields: z.record(z.string(), z.unknown()).optional(),
  page: z.coerce.number().optional().default(1),
  perPage: z.coerce.number().optional().default(25),
});

export type InventoryValuationQuery = z.infer<typeof inventoryValuationQuerySchema>;

export interface PaginatedInventoryValuationResponse {
  results: InventoryValuationRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  grandTotalQty: number;
  grandTotalValue: number;
}

export interface InventoryValuationRow {
  itemId: string;
  itemName: string;
  categoryName: string | null;
  uomName: string | null;
  sku: string | null;
  hsnCode: string | null;
  customFields: Record<string, unknown>;
  stockOnHand: number;
  inventoryAssetValue: number;
}

export const itemLedgerQuerySchema = z.object({
  locationId: z.string().uuid().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export type ItemLedgerQuery = z.infer<typeof itemLedgerQuerySchema>;

export interface ItemLedgerRow {
  date: string | null; // null for opening/closing stock rows
  transactionDetails: string;
  quantity: number;
  unitCost: number | null;
  totalCost: number;
  /** Null on the first row of a value adjustment's pair: the running figures
   * would otherwise show stock that was never there between the two rows. */
  stockOnHand: number | null;
  inventoryAssetValue: number | null;
  isOpeningStock?: boolean;
  isClosingStock?: boolean;
  sourceDocType?: string | null;
  sourceDocId?: string | null;
  sourceDocNumber?: string | null;
  /** The line is the document's cancellation, not a fresh movement. */
  isCancellation?: boolean;
}

export interface ItemLedgerResponse {
  itemInfo: {
    itemName: string;
    sku: string | null;
    uomName: string | null;
  };
  rows: ItemLedgerRow[];
}
