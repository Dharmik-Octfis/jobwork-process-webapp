import type { Request, Response } from 'express';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { getBillsReport } from './billsReport.service.ts';
import { billsReportQuerySchema } from './billsReport.schemas.ts';

export const getBillsReportRoute = async (req: Request, res: Response) => {
  const query = billsReportQuerySchema.parse(req.query);
  const result = await getBillsReport(req.tenantId!, query);
  sendSuccess(res, result);
};
