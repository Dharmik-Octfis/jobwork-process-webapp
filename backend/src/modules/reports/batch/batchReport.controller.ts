import type { Request, Response } from 'express';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { getBatchReport } from './batchReport.service.ts';
import { batchReportQuerySchema } from './batchReport.schemas.ts';

export const getBatchReportController = async (req: Request, res: Response) => {
  const parsed = batchReportQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid report filters.');
  sendSuccess(res, await getBatchReport(req.tenantId!, parsed.data));
};
