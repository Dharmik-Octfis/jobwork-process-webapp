import type { Request, Response } from 'express';
import { ApiError } from '../../../lib/apiError.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { getJobOrdersReport } from './jobOrdersReport.service.ts';
import { jobOrdersReportQuerySchema } from './jobOrdersReport.schemas.ts';

export async function getJobOrdersReportHandler(req: Request, res: Response) {
  const query = jobOrdersReportQuerySchema.safeParse(req.query);
  if (!query.success) {
    throw new ApiError(400, 'Invalid query parameters', query.error.issues);
  }

  const result = await getJobOrdersReport(req.tenantId!, query.data);
  return sendSuccess(res, result);
}
