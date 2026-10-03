import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import { paginatedSchema, type PageParams, type Paginated } from '../../../lib/pagination';
import {
  adjustmentReasonListSchema,
  adjustmentReasonSchema,
  stockAdjustmentDetailSchema,
  stockAdjustmentRowSchema,
  type AdjustmentReason,
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

export interface CurrentValue {
  itemId: string;
  quantity: string;
  value: string;
}

/** Quantity and value on hand per item at one location — a value adjustment's "Current Value". */
export async function fetchCurrentValues(
  orgId: string,
  params: { locationId: string; itemIds: readonly string[] },
): Promise<CurrentValue[]> {
  const response = await apiClient.get(`${endpoints.inventory.adjustments(orgId)}/current-values`, {
    params: { locationId: params.locationId, itemIds: params.itemIds.join(',') },
  });
  return response.data as CurrentValue[];
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

export async function fetchReasons(orgId: string): Promise<AdjustmentReason[]> {
  const response = await apiClient.get(`${endpoints.inventory.adjustments(orgId)}/reasons`);
  return adjustmentReasonListSchema.parse(response.data);
}

export async function createReason(orgId: string, name: string): Promise<AdjustmentReason> {
  const response = await apiClient.post(`${endpoints.inventory.adjustments(orgId)}/reasons`, {
    name,
  });
  return adjustmentReasonSchema.parse(response.data);
}

export async function setReasonActive(orgId: string, id: string, isActive: boolean) {
  await apiClient.patch(`${endpoints.inventory.adjustments(orgId)}/reasons/${id}`, { isActive });
}

/** Refused (409) for a reason any adjustment uses. */
export async function deleteReason(orgId: string, id: string) {
  await apiClient.delete(`${endpoints.inventory.adjustments(orgId)}/reasons/${id}`);
}
