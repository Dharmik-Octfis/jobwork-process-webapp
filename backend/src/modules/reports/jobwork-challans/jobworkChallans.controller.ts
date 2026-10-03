import type { Request, Response } from 'express';
import { ApiError } from '../../../lib/apiError.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { getJobworkChallans } from './jobworkChallans.service.ts';
import { jobworkChallansQuerySchema } from './jobworkChallans.schemas.ts';

export async function getJobworkChallansHandler(req: Request, res: Response) {
  const result = jobworkChallansQuerySchema.safeParse(req.query);
  if (!result.success) {
    throw ApiError.badRequest('Invalid query parameters', result.error.issues);
  }

  const data = await getJobworkChallans(req.tenantId!, result.data);
  sendSuccess(res, data);
}
