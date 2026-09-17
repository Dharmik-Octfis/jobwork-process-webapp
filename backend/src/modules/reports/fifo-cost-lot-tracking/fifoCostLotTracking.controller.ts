import type { Request, Response } from 'express';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { getFifoCostLotTracking } from './fifoCostLotTracking.service.ts';
import { fifoCostLotTrackingQuerySchema } from './fifoCostLotTracking.schemas.ts';

export const getFifoCostLotTrackingController = async (req: Request, res: Response) => {
  const query = fifoCostLotTrackingQuerySchema.parse(req.query);
  const rows = await getFifoCostLotTracking(req.tenantId!, query);
  sendSuccess(res, rows);
};
