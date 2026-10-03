import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiError } from '../../../lib/apiError.js';
import { sendSuccess } from '../../../lib/apiResponse.js';
import { adjustmentReasonsService } from './adjustmentReasons.service.js';

// A non-uuid would reach Postgres as a cast error and surface as a 500.
function reasonId(req: Request): string {
  const parsed = z.string().uuid().safeParse(req.params.reasonId);
  if (!parsed.success) throw ApiError.notFound('Reason not found.');
  return parsed.data;
}

export const getReasons = async (req: Request, res: Response) => {
  sendSuccess(res, await adjustmentReasonsService.list(req.tenantId!));
};

export const createReason = async (req: Request, res: Response) => {
  const reason = await adjustmentReasonsService.create(req.tenantId!, req.user!.id, req.body.name);
  sendSuccess(res, reason, `"${reason.name}" added.`, 201);
};

export const setReasonActive = async (req: Request, res: Response) => {
  const reason = await adjustmentReasonsService.setActive(
    req.tenantId!,
    req.user!.id,
    reasonId(req),
    req.body.isActive,
  );
  sendSuccess(
    res,
    reason,
    `"${reason.name}" marked as ${reason.isActive ? 'active' : 'inactive'}.`,
  );
};

export const deleteReason = async (req: Request, res: Response) => {
  const name = await adjustmentReasonsService.remove(req.tenantId!, req.user!.id, reasonId(req));
  sendSuccess(res, null, `"${name}" deleted.`);
};
