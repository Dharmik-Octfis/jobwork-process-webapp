import { apiClient } from '../../api/client';
import { endpoints } from '../../api/endpoints';

export interface InventoryValuationQuery {
  asOfDate?: string;
  stockAvailability?: 'none' | 'gt' | 'lte' | 'lt' | 'eq' | 'neq';
  status?: 'all' | 'active' | 'inactive';
  itemName?: string;
  categoryName?: string;
  locationId?: string;
  sku?: string;
  hsnCode?: string;
  itemCustomFields?: Record<string, unknown>;
  page?: number;
  perPage?: number;
}

export interface InventoryValuationRow {
  itemId: string;
  itemName: string;
  sku: string | null;
  hsnCode: string | null;
  categoryName: string | null;
  uomName: string | null;
  customFields: Record<string, unknown>;
  stockOnHand: number;
  inventoryAssetValue: number;
}

export interface PaginatedInventoryValuationResponse {
  results: InventoryValuationRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  grandTotalQty: number;
  grandTotalValue: number;
}

export interface StockSummaryQuery {
  fromDate?: string;
  toDate?: string;
  status?: 'all' | 'active' | 'inactive';
  itemName?: string;
  categoryName?: string;
  locationId?: string;
  sku?: string;
  hsnCode?: string;
  itemCustomFields?: Record<string, unknown>;
  page?: number;
  perPage?: number;
}

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

export interface ItemLedgerQuery {
  fromDate?: string;
  toDate?: string;
}

export interface ItemLedgerRow {
  date: string | null;
  transactionDetails: string;
  quantity: number;
  unitCost: number | null;
  totalCost: number;
  stockOnHand: number;
  inventoryAssetValue: number;
  isOpeningStock?: boolean;
  isClosingStock?: boolean;
  sourceDocType?: string | null;
  sourceDocId?: string | null;
  sourceDocNumber?: string | null;
}

export interface ItemLedgerResponse {
  itemInfo: {
    itemName: string;
    sku: string | null;
    uomName: string | null;
  };
  rows: ItemLedgerRow[];
}

export interface FifoCostLotTrackingQuery {
  fromDate?: string;
  toDate?: string;
  itemName?: string;
  locationName?: string;
  page?: number;
  perPage?: number;
  reportBasis?: 'product_in' | 'product_out';
}

export interface PaginatedFifoCostLotTrackingResponse {
  results: FifoCostLotTrackingRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface FifoCostLotTrackingRow {
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

export interface StockMovementQuery {
  itemId?: string;
  fromDate?: string;
  toDate?: string;
  movementType?: 'all' | 'inward' | 'outward';
  page?: number;
  perPage?: number;
}

export interface StockMovementRow {
  id: string;
  transactionDate: string;
  transactionNumber: string;
  itemId: string;
  itemName: string;
  createdAt: string;
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

export const reportsApi = {
  getStockMovement: async (
    orgId: string,
    params: StockMovementQuery = {},
  ): Promise<PaginatedStockMovementResponse> => {
    const response = await apiClient.get(`/organizations/${orgId}/reports/stock-movement`, {
      params,
    });
    return response.data as PaginatedStockMovementResponse;
  },
  getInventoryValuation: async (
    orgId: string,
    params: InventoryValuationQuery = {},
  ): Promise<PaginatedInventoryValuationResponse> => {
    const response = await apiClient.get(endpoints.reports.inventoryValuation(orgId), { params });
    // Assume unwrapped response by client interceptor
    return response.data as PaginatedInventoryValuationResponse;
  },
  getItemLedger: async (
    orgId: string,
    itemId: string,
    params: ItemLedgerQuery = {},
  ): Promise<ItemLedgerResponse> => {
    const response = await apiClient.get(
      `${endpoints.reports.inventoryValuation(orgId)}/${itemId}`,
      { params },
    );
    return response.data as ItemLedgerResponse;
  },
  getFifoCostLotTracking: async (
    orgId: string,
    params: FifoCostLotTrackingQuery = {},
  ): Promise<PaginatedFifoCostLotTrackingResponse> => {
    const response = await apiClient.get(endpoints.reports.fifoCostLotTracking(orgId), { params });
    return response.data as PaginatedFifoCostLotTrackingResponse;
  },
  getStockSummary: async (
    orgId: string,
    params: StockSummaryQuery = {},
  ): Promise<PaginatedStockSummaryResponse> => {
    // Note: endpoint needs to be added in endpoints.ts, for now using a placeholder or assuming it exists
    const response = await apiClient.get(`/organizations/${orgId}/reports/stock-summary`, {
      params,
    });
    return response.data as PaginatedStockSummaryResponse;
  },
};
