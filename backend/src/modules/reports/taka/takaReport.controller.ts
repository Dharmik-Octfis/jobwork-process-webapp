import type { Request, Response } from 'express';
import { ApiError } from '../../../lib/apiError.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { getTakaReport } from './takaReport.service.ts';
import { takaReportQuerySchema } from './takaReport.schemas.ts';

export async function getTakaReportHandler(req: Request, res: Response) {
  const result = takaReportQuerySchema.safeParse(req.query);
  if (!result.success) {
    throw ApiError.badRequest('Invalid query parameters', result.error.issues);
  }

  const data = await getTakaReport(req.tenantId!, result.data);
  sendSuccess(res, data);
}
