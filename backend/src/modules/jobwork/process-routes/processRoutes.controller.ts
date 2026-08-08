import type { Request, Response } from 'express';
import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { listQuerySchema } from '../../../lib/pagination.ts';
import {
  countRoutes,
  createNewRoute,
  deleteRouteById,
  getRouteById,
  getRoutesList,
  updateRouteById,
} from './processRoutes.service.ts';
import { createRouteSchema, type CreateRouteInput } from './processRoutes.schemas.ts';

/**
 * No try/catch anywhere in this file — Express 5 forwards a rejected promise
 * straight to `errorHandler`. The service throws `ApiError` (including the
 * chain-check 400, whose `details` are keyed `steps.<n>.issueItemId` so the grid
 * can highlight the offending row); the controller only does the happy path.
 */

const orgParam = z.object({ orgId: z.string() });

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/jobwork/routes',
  tags: ['Process Routes'],
  summary: 'List process routes (paginated, searchable)',
  request: {
    params: orgParam,
    query: z.object({
      search: z.string().optional(),
      filter: z.string().optional(),
      page: z.string().optional(),
      perPage: z.string().optional(),
    }),
  },
  responses: { 200: { description: 'Paginated routes: { results, pageContext }' } },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/organizations/{orgId}/jobwork/routes',
  tags: ['Process Routes'],
  summary: 'Create a process route with its steps',
  request: {
    params: orgParam,
    body: { content: { 'application/json': { schema: createRouteSchema } } },
  },
  responses: {
    201: { description: 'Route created' },
    400: { description: 'Validation failed, or the step chain is broken' },
    409: { description: 'Route name already exists in this organization' },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/jobwork/routes/{id}',
  tags: ['Process Routes'],
  summary: 'Get a route and its steps',
  request: { params: orgParam.extend({ id: z.string() }) },
  responses: { 200: { description: 'Route' }, 404: { description: 'Not found' } },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/organizations/{orgId}/jobwork/routes/{id}',
  tags: ['Process Routes'],
  summary: 'Update a route (steps are replaced wholesale)',
  request: {
    params: orgParam.extend({ id: z.string() }),
    body: { content: { 'application/json': { schema: createRouteSchema } } },
  },
  responses: {
    200: { description: 'Route updated' },
    404: { description: 'Not found' },
    409: { description: 'Route name already exists in this organization' },
  },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/organizations/{orgId}/jobwork/routes/{id}',
  tags: ['Process Routes'],
  summary: 'Delete a route (soft)',
  request: { params: orgParam.extend({ id: z.string() }) },
  responses: { 200: { description: 'Route deleted' }, 404: { description: 'Not found' } },
});

export const getRoutes = async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  sendSuccess(res, await getRoutesList(req.tenantId!, parsed.data));
};

export const getRouteCount = async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  sendSuccess(res, { total: await countRoutes(req.tenantId!, parsed.data) });
};

export const createRoute = async (req: Request, res: Response) => {
  const created = await createNewRoute(req.tenantId!, req.body as CreateRouteInput, req.user?.id);
  sendSuccess(res, created, 'Route created.', 201);
};

export const getRoute = async (req: Request, res: Response) => {
  const found = await getRouteById(req.tenantId!, req.params.id as string);
  if (!found) throw ApiError.notFound('Route not found');
  sendSuccess(res, found);
};

export const updateRoute = async (req: Request, res: Response) => {
  const updated = await updateRouteById(
    req.tenantId!,
    req.params.id as string,
    req.body as CreateRouteInput,
    req.user?.id,
  );
  sendSuccess(res, updated, 'Route updated.');
};

export const deleteRoute = async (req: Request, res: Response) => {
  await deleteRouteById(req.tenantId!, req.params.id as string, req.user?.id);
  sendSuccess(res, null, 'Route deleted.');
};
