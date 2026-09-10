import { apiClient } from '../../api/client';
import { endpoints } from '../../api/endpoints';

export interface InventoryValuationQuery {
  asOfDate?: string;
  stockAvailability?: 'none' | 'gt' | 'lte' | 'lt' | 'eq' | 'neq';
  status?: 'all' | 'active' | 'inactive';
}

export interface InventoryValuationRow {
  itemId: string;
  itemName: string;
  categoryName: string | null;
  uomName: string | null;
  stockOnHand: number;
  inventoryAssetValue: number;
}

export const reportsApi = {
  getInventoryValuation: async (orgId: string, params: InventoryValuationQuery = {}): Promise<InventoryValuationRow[]> => {
    const response = await apiClient.get(endpoints.reports.inventoryValuation(orgId), { params });
    // Assume unwrapped response by client interceptor
    return response.data as InventoryValuationRow[];
  },
};
