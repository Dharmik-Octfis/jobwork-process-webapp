import type { Request, Response } from 'express';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { getSalesOrdersReport } from './salesOrdersReport.service.ts';
import { salesOrdersReportQuerySchema } from './salesOrdersReport.schemas.ts';

export const getSalesOrdersReportRoute = async (req: Request, res: Response) => {
  const query = salesOrdersReportQuerySchema.parse(req.query);
  const result = await getSalesOrdersReport(req.tenantId!, query);
  sendSuccess(res, result);
};
