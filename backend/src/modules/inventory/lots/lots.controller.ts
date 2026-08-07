import type { Request, Response } from 'express';
import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { listQuerySchema } from '../../../lib/pagination.ts';
import { OWNERSHIPS } from '../stock-ledger/stockLedger.service.ts';
import {
  countLots,
  getAvailableStock,
  getLotById,
  getLotsList,
  getSourceLocations,
} from './lots.service.ts';

const orgParam = z.object({ orgId: z.string() });

/** Query for the picker. `itemId` is required — an availability query with no
 * item is a full table scan pretending to be a dropdown. */
const availabilityQuerySchema = z.object({
  itemId: z.string().uuid(),
  locationId: z.string().uuid().optional(),
  ownership: z.enum(OWNERSHIPS).optional(),
  withPackages: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/inventory/lots/available',
  tags: ['Lots'],
  summary: 'Lots that can actually be issued — a LEDGER query, not the lots table',
  request: {
    params: orgParam,
    query: z.object({
      itemId: z.string(),
      locationId: z.string().optional(),
      ownership: z.string().optional(),
      withPackages: z.string().optional(),
    }),
  },
  responses: { 200: { description: 'Available lots, each with its takas when tracked' } },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/inventory/lots/locations',
  tags: ['Lots'],
  summary: 'Locations actually holding this item, with balances',
  request: {
    params: orgParam,
    query: z.object({ itemId: z.string(), ownership: z.string().optional() }),
  },
  responses: { 200: { description: 'Locations with a positive balance' } },
});

export const getLots = async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  sendSuccess(res, await getLotsList(req.tenantId!, parsed.data));
};

export const getLotCount = async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  sendSuccess(res, { total: await countLots(req.tenantId!, parsed.data) });
};

export const getAvailable = async (req: Request, res: Response) => {
  const parsed = availabilityQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('An item is required to look up stock.');
  sendSuccess(res, await getAvailableStock(req.tenantId!, parsed.data));
};

export const getLocations = async (req: Request, res: Response) => {
  const parsed = availabilityQuerySchema
    .pick({ itemId: true, ownership: true })
    .safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('An item is required to look up stock.');
  sendSuccess(res, await getSourceLocations(req.tenantId!, parsed.data));
};

export const getLot = async (req: Request, res: Response) => {
  const found = await getLotById(req.tenantId!, req.params.id as string);
  if (!found) throw ApiError.notFound('Lot not found');
  sendSuccess(res, found);
};
