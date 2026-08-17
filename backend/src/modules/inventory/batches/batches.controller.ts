import type { Request, Response } from 'express';
import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { listQuerySchema } from '../../../lib/pagination.ts';
import { OWNERSHIPS } from '../stock-ledger/stockLedger.service.ts';
import {
  countBatches,
  getAvailableStock,
  getBatchById,
  getBatchesList,
  getSourceLocations,
} from './batches.service.ts';

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
  /** The picker narrows by typing rather than paging: a batch is looked up by the
   * number on its tag, and nobody walks page 7 of a batch list. */
  search: z.string().trim().min(1).max(100).optional(),
  /**
   * A ceiling, and it has a default on purpose. An item with three hundred live
   * batches is normal in a mill, and the picker that renders them is inside a
   * dialog — so the answer is bounded here and narrowed with `search`.
   */
  limit: z.coerce.number().int().positive().max(500).default(200),
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/inventory/batches/available',
  tags: ['Batches'],
  summary: 'Batches that can actually be issued — a LEDGER query, not the batches table',
  request: {
    params: orgParam,
    query: z.object({
      itemId: z.string(),
      locationId: z.string().optional(),
      ownership: z.string().optional(),
      withPackages: z.string().optional(),
      search: z.string().optional(),
      limit: z.string().optional(),
    }),
  },
  responses: { 200: { description: 'Available batches, newest balances derived from the ledger' } },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/inventory/batches/locations',
  tags: ['Batches'],
  summary: 'Locations actually holding this item, with balances',
  request: {
    params: orgParam,
    query: z.object({ itemId: z.string(), ownership: z.string().optional() }),
  },
  responses: { 200: { description: 'Locations with a positive balance' } },
});

export const getBatches = async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  sendSuccess(res, await getBatchesList(req.tenantId!, parsed.data));
};

export const getBatchCount = async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  sendSuccess(res, { total: await countBatches(req.tenantId!, parsed.data) });
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

export const getBatch = async (req: Request, res: Response) => {
  const found = await getBatchById(req.tenantId!, req.params.id as string);
  if (!found) throw ApiError.notFound('Batch not found');
  sendSuccess(res, found);
};
