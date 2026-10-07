import type { Request, Response, NextFunction } from 'express';
import { getStockMovementReport } from './stockMovement.service.ts';
import { stockMovementQuerySchema } from './stockMovement.schemas.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';

export async function getStockMovement(req: Request, res: Response, next: NextFunction) {
  try {
    const organizationId = req.tenantId!;
    const query = stockMovementQuerySchema.parse(req.query);

    const data = await getStockMovementReport(organizationId, query);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}
