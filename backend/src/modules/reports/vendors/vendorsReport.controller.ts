import type { Request, Response } from 'express';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { getVendorsReport } from './vendorsReport.service.ts';
import { vendorsReportQuerySchema } from './vendorsReport.schemas.ts';

export const getVendorsReportRoute = async (req: Request, res: Response) => {
  const query = vendorsReportQuerySchema.parse(req.query);
  const result = await getVendorsReport(req.tenantId!, query);
  sendSuccess(res, result);
};
