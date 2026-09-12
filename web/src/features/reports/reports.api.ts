import { apiClient } from '../../api/client';
import { endpoints } from '../../api/endpoints';

export interface InventoryValuationQuery {
  asOfDate?: string;
  stockAvailability?: 'none' | 'gt' | 'lte' | 'lt' | 'eq' | 'neq';
  status?: 'all' | 'active' | 'inactive';
  itemName?: string;
  categoryName?: string;
}

export interface InventoryValuationRow {
  itemId: string;
  itemName: string;
  categoryName: string | null;
  uomName: string | null;
  stockOnHand: number;
  inventoryAssetValue: number;
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

export const reportsApi = {
  getInventoryValuation: async (orgId: string, params: InventoryValuationQuery = {}): Promise<InventoryValuationRow[]> => {
    const response = await apiClient.get(endpoints.reports.inventoryValuation(orgId), { params });
    // Assume unwrapped response by client interceptor
    return response.data as InventoryValuationRow[];
  },
  getItemLedger: async (orgId: string, itemId: string, params: ItemLedgerQuery = {}): Promise<ItemLedgerResponse> => {
    const response = await apiClient.get(`${endpoints.reports.inventoryValuation(orgId)}/${itemId}`, { params });
    return response.data as ItemLedgerResponse;
  },
};
