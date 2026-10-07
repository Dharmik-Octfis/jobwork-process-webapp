import type { Request, Response, NextFunction } from 'express';
import { getStockSummaryReport } from './stockSummary.service.ts';
import { stockSummaryQuerySchema } from './stockSummary.schemas.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';

export async function getStockSummary(req: Request, res: Response, next: NextFunction) {
  try {
    const organizationId = req.tenantId!;
    const query = stockSummaryQuerySchema.parse(req.query);

    const data = await getStockSummaryReport(organizationId, query);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}
