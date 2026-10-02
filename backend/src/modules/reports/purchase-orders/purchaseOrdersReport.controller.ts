import type { Request, Response } from 'express';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { getPurchaseOrdersReport } from './purchaseOrdersReport.service.ts';
import { purchaseOrdersReportQuerySchema } from './purchaseOrdersReport.schemas.ts';

export const getPurchaseOrdersReportRoute = async (req: Request, res: Response) => {
  const query = purchaseOrdersReportQuerySchema.parse(req.query);
  const result = await getPurchaseOrdersReport(req.tenantId!, query);
  sendSuccess(res, result);
};
