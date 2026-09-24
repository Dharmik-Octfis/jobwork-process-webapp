import { z } from 'zod';

export const fifoCostLotTrackingQuerySchema = z.object({
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  itemName: z.string().optional(),
  locationName: z.string().optional(),
  reportBasis: z.enum(['product_in', 'product_out']).optional().default('product_in'),
  page: z.coerce.number().optional().default(1),
  perPage: z.coerce.number().optional().default(25),
});

export type FifoCostLotTrackingQuery = z.infer<typeof fifoCostLotTrackingQuerySchema>;

export interface PaginatedFifoCostLotTrackingResponse {
  results: FifoCostLotTrackingRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface FifoCostLotTrackingRow {
  /** One lot = one document's stock at one cost; rows sharing it are its dispersals. */
  lotKey: string;
  inDate: string | null;
  inTransaction: string;
  inReceivedFrom: string;
  inQty: number | null;
  inQtyUnit: string;
  inQtyRemaining: number;
  inAge: string;
  inCost: string;
  inTotal: string;

  inDocType: string;
  inDocId: string;

  inPartyId: string | null;
  inPartyType: 'vendor' | 'customer' | null;
  itemName?: string;

  outDate: string | null;
  outTransaction: string;
  outDispersedTo: string;
  outQty: number | null;
  outQtyUnit: string;
  outDocType: string;
  outDocId: string;
  outPartyId: string | null;
  outPartyType: 'vendor' | 'customer' | null;
}
