import type { Request, Response } from 'express';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { getCustomersReport } from './customersReport.service.ts';
import { customersReportQuerySchema } from './customersReport.schemas.ts';

export const getCustomersReportRoute = async (req: Request, res: Response) => {
  const query = customersReportQuerySchema.parse(req.query);
  const result = await getCustomersReport(req.tenantId!, query);
  sendSuccess(res, result);
};
