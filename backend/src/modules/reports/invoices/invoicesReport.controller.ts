import type { Request, Response } from 'express';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { getInvoicesReport } from './invoicesReport.service.ts';
import { invoicesReportQuerySchema } from './invoicesReport.schemas.ts';

export const getInvoicesReportRoute = async (req: Request, res: Response) => {
  const query = invoicesReportQuerySchema.parse(req.query);
  const result = await getInvoicesReport(req.tenantId!, query);
  sendSuccess(res, result);
};
