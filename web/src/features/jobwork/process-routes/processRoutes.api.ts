import { z } from 'zod';
import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import type { PageParams } from '../../../lib/pagination';
import {
  routeSchema,
  routesPageSchema,
  type CreateRouteData,
  type Route,
  type RoutesPage,
  type UpdateRouteData,
} from './processRoutes.schemas';

/** `apiClient` unwraps the `{ statusCode, message, data }` envelope, so
 * `response.data` here is already the inner value. */

export async function fetchRoutes(orgId: string, params: PageParams = {}): Promise<RoutesPage> {
  const response = await apiClient.get(endpoints.jobwork.routes(orgId), { params });
  return routesPageSchema.parse(response.data);
}

export async function fetchRouteCount(orgId: string, params: PageParams = {}): Promise<number> {
  const response = await apiClient.get(`${endpoints.jobwork.routes(orgId)}/count`, { params });
  return z.object({ total: z.number() }).parse(response.data).total;
}

export async function fetchRouteById(orgId: string, id: string): Promise<Route> {
  const response = await apiClient.get(`${endpoints.jobwork.routes(orgId)}/${id}`);
  return routeSchema.parse(response.data);
}

export async function createRoute(orgId: string, data: CreateRouteData): Promise<Route> {
  const response = await apiClient.post(endpoints.jobwork.routes(orgId), data);
  return routeSchema.parse(response.data);
}

export async function updateRoute({
  orgId,
  id,
  data,
}: {
  orgId: string;
  id: string;
  data: UpdateRouteData;
}): Promise<Route> {
  const response = await apiClient.put(`${endpoints.jobwork.routes(orgId)}/${id}`, data);
  return routeSchema.parse(response.data);
}

export async function deleteRoute(orgId: string, id: string): Promise<void> {
  await apiClient.delete(`${endpoints.jobwork.routes(orgId)}/${id}`);
}
