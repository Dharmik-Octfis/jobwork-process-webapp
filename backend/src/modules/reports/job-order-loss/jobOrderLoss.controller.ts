import type { Request, Response } from 'express';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { getJobOrderLossReport } from './jobOrderLoss.service.ts';
import { jobOrderLossQuerySchema } from './jobOrderLoss.schemas.ts';

export const getJobOrderLoss = async (req: Request, res: Response) => {
  const parsed = jobOrderLossQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid report filters.');
  sendSuccess(res, await getJobOrderLossReport(req.tenantId!, parsed.data));
};
