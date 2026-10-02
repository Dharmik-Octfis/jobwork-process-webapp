import type { Request, Response } from 'express';
import { ApiError } from '../../../lib/apiError.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { jobworkReceiptsQuerySchema } from './jobworkReceipts.schemas.ts';
import { getJobworkReceipts } from './jobworkReceipts.service.ts';

export async function getJobworkReceiptsHandler(req: Request, res: Response) {
  const result = jobworkReceiptsQuerySchema.safeParse(req.query);
  if (!result.success) {
    throw ApiError.badRequest('Invalid query parameters', result.error.issues);
  }

  const data = await getJobworkReceipts(req.tenantId!, result.data);
  sendSuccess(res, data);
}
