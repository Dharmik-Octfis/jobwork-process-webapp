import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiError } from '../../../lib/apiError.js';
import { sendSuccess } from '../../../lib/apiResponse.js';
import { listQuerySchema } from '../../../lib/pagination.js';
import { adjustmentsService } from './adjustments.service.js';

// A non-uuid would reach Postgres as a cast error and surface as a 500.
function adjustmentId(req: Request): string {
  const parsed = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success) throw ApiError.notFound('Stock adjustment not found.');
  return parsed.data;
}

export const getAdjustments = async (req: Request, res: Response) => {
  const opts = listQuerySchema.parse(req.query);
  // Counting is opt-in (`?count=true`) — the "Total count: view" link.
  const [results, count] = await Promise.all([
    adjustmentsService.findManyAdjustments(req.tenantId!, opts),
    req.query.count ? adjustmentsService.countAdjustments(req.tenantId!, opts) : undefined,
  ]);
  sendSuccess(res, { ...results, count });
};

export const getAdjustmentById = async (req: Request, res: Response) => {
  sendSuccess(res, await adjustmentsService.getAdjustment(req.tenantId!, adjustmentId(req)));
};

export const createAdjustment = async (req: Request, res: Response) => {
  const adjustment = await adjustmentsService.createAdjustment(
    req.tenantId!,
    req.user!.id,
    req.body,
  );
  sendSuccess(res, adjustment, 'Stock adjusted.', 201);
};

export const cancelAdjustment = async (req: Request, res: Response) => {
  const adjustment = await adjustmentsService.cancelAdjustment(
    req.tenantId!,
    adjustmentId(req),
    req.user!.id,
  );
  sendSuccess(res, adjustment, 'Adjustment cancelled.');
};
