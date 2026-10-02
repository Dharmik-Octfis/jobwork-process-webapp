import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import { paginatedSchema, type PageParams, type Paginated } from '../../../lib/pagination';
import {
  stockAdjustmentDetailSchema,
  stockAdjustmentRowSchema,
  stockAdjustmentSchema,
  type CreateAdjustmentPayload,
  type StockAdjustment,
  type StockAdjustmentDetail,
  type StockAdjustmentRow,
} from './adjustments.schemas';

const pageSchema = paginatedSchema(stockAdjustmentRowSchema);

export async function fetchAdjustments(
  orgId: string,
  params: PageParams = {},
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

export async function createAdjustment(
  orgId: string,
  payload: CreateAdjustmentPayload,
): Promise<StockAdjustment> {
  const response = await apiClient.post(endpoints.inventory.adjustments(orgId), payload);
  return stockAdjustmentSchema.parse(response.data);
}

/** Cancel: the stock movements are reversed and the adjustment stays listed. */
export async function cancelAdjustment(orgId: string, id: string): Promise<StockAdjustmentDetail> {
  const response = await apiClient.delete(`${endpoints.inventory.adjustments(orgId)}/${id}`);
  return stockAdjustmentDetailSchema.parse(response.data);
}
