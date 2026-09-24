import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiError } from '../../lib/apiError.ts';
import { sendSuccess } from '../../lib/apiResponse.ts';
import { isReportKey, type ReportKey } from './reports.catalog.ts';
import { listReports, recordReportVisit, setReportFavorite } from './reports.service.ts';

export const setFavoriteSchema = z.object({ isFavorite: z.boolean() });
type SetFavoriteInput = z.infer<typeof setFavoriteSchema>;

// A key outside the catalog is a 400, so no row can ever be written for a report that does not exist.
function reportKeyOf(req: Request): ReportKey {
  const raw = req.params.reportKey;
  if (typeof raw !== 'string' || !isReportKey(raw)) {
    throw ApiError.badRequest('Unknown report.');
  }
  return raw;
}

export const listReportsRoute = async (req: Request, res: Response) => {
  const data = await listReports(req.tenantId!, req.user!.id);
  sendSuccess(res, data);
};

export const recordVisitRoute = async (req: Request, res: Response) => {
  const data = await recordReportVisit(req.tenantId!, req.user!.id, reportKeyOf(req));
  sendSuccess(res, data);
};

export const setFavoriteRoute = async (req: Request, res: Response) => {
  const { isFavorite } = req.body as SetFavoriteInput;
  const data = await setReportFavorite(req.tenantId!, req.user!.id, reportKeyOf(req), isFavorite);
  // Default 'Success' message: the client toasts any other mutation message, and a star click needs none.
  sendSuccess(res, data);
};
