import { apiClient } from '../../api/client';
import { endpoints } from '../../api/endpoints';

export interface InventoryValuationQuery {
  asOfDate?: string;
  stockAvailability?: 'none' | 'gt' | 'lte' | 'lt' | 'eq' | 'neq';
  status?: 'all' | 'active' | 'inactive';
  itemName?: string;
  categoryName?: string;
  page?: number;
  perPage?: number;
}

export interface InventoryValuationRow {
  itemId: string;
  itemName: string;
  categoryName: string | null;
  uomName: string | null;
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
  inQty: number;
  inQtyUnit: string;
  inQtyRemaining: number;
  inAge: string;
  inCost: string;
  inTotal: string;

  inDocType: string;
  inDocId: string;

  inPartyId: string | null;
  inPartyType: 'vendor' | 'customer' | null;

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

export const reportsApi = {
  getInventoryValuation: async (orgId: string, params: InventoryValuationQuery = {}): Promise<PaginatedInventoryValuationResponse> => {
    const response = await apiClient.get(endpoints.reports.inventoryValuation(orgId), { params });
    // Assume unwrapped response by client interceptor
    return response.data as PaginatedInventoryValuationResponse;
  },
  getItemLedger: async (orgId: string, itemId: string, params: ItemLedgerQuery = {}): Promise<ItemLedgerResponse> => {
    const response = await apiClient.get(`${endpoints.reports.inventoryValuation(orgId)}/${itemId}`, { params });
    return response.data as ItemLedgerResponse;
  },
  getFifoCostLotTracking: async (orgId: string, params: FifoCostLotTrackingQuery = {}): Promise<PaginatedFifoCostLotTrackingResponse> => {
    const response = await apiClient.get(endpoints.reports.fifoCostLotTracking(orgId), { params });
    return response.data as PaginatedFifoCostLotTrackingResponse;
  },
};
