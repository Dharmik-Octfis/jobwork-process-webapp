import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import { paginatedSchema, type PageParams, type Paginated } from '../../../lib/pagination';
import {
  stockAdjustmentDetailSchema,
  stockAdjustmentRowSchema,
  type SaveAdjustmentPayload,
  type StockAdjustmentDetail,
  type StockAdjustmentRow,
} from './adjustments.schemas';

const pageSchema = paginatedSchema(stockAdjustmentRowSchema);

export async function fetchAdjustments(
  orgId: string,
  /** `itemId` narrows the list to one item — the item page's Transactions tab. */
  params: PageParams & { itemId?: string } = {},
): Promise<Paginated<StockAdjustmentRow>> {
  const response = await apiClient.get(endpoints.inventory.adjustments(orgId), { params });
  return pageSchema.parse(response.data);
}

/** The opt-in total — same query, `count=true`. */
export async function fetchAdjustmentCount(
  orgId: string,
  params: PageParams = {},
): Promise<number> {
  const response = await apiClient.get(endpoints.inventory.adjustments(orgId), {
    params: { ...params, perPage: 10, count: true },
  });
  return (response.data as { count: number }).count;
}

export async function fetchAdjustment(orgId: string, id: string): Promise<StockAdjustmentDetail> {
  const response = await apiClient.get(`${endpoints.inventory.adjustments(orgId)}/${id}`);
  return stockAdjustmentDetailSchema.parse(response.data);
}

export interface FifoCost {
  quantity: string;
  value: string;
  /** Null when the location holds no costed stock of the item. */
  unitCost: string | null;
}

/** What removing `quantity` would cost by FIFO right now — a decrease's cost price. */
export async function fetchFifoCost(
  orgId: string,
  params: { itemId: string; locationId: string; quantity: number },
): Promise<FifoCost> {
  const response = await apiClient.get(`${endpoints.inventory.adjustments(orgId)}/fifo-cost`, {
    params,
  });
  return response.data as FifoCost;
}

/** Create — as a draft, or adjusted in the same request (`saveAs`). */
export async function createAdjustment(
  orgId: string,
  payload: SaveAdjustmentPayload,
): Promise<StockAdjustmentDetail> {
  const response = await apiClient.post(endpoints.inventory.adjustments(orgId), payload);
  return stockAdjustmentDetailSchema.parse(response.data);
}

/** Replace an adjustment that has not posted yet. */
export async function updateAdjustment(
  orgId: string,
  id: string,
  payload: SaveAdjustmentPayload,
): Promise<StockAdjustmentDetail> {
  const response = await apiClient.put(`${endpoints.inventory.adjustments(orgId)}/${id}`, payload);
  return stockAdjustmentDetailSchema.parse(response.data);
}

/** Adjust an unposted adjustment as it stands — posts it, or sends it for approval. */
export async function adjustAdjustment(orgId: string, id: string): Promise<StockAdjustmentDetail> {
  const response = await apiClient.post(`${endpoints.inventory.adjustments(orgId)}/${id}/adjust`);
  return stockAdjustmentDetailSchema.parse(response.data);
}

/** Cancels a posted adjustment (reversed, stays listed) or deletes an unposted one. */
export async function removeAdjustment(orgId: string, id: string): Promise<StockAdjustmentDetail> {
  const response = await apiClient.delete(`${endpoints.inventory.adjustments(orgId)}/${id}`);
  return stockAdjustmentDetailSchema.parse(response.data);
}
