import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiError } from '../../../lib/apiError.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { LIST_ENTITY_TYPES, isListEntityType, type ListEntityType } from './listViews.catalog.ts';
import { getListView, saveListView } from './listViews.service.ts';

/** Body for saving a layout: the ordered list of visible column keys. */
export const saveListViewSchema = z.object({
  columns: z.array(z.string().min(1).max(120)).max(200),
});
export type SaveListViewInput = z.infer<typeof saveListViewSchema>;

/**
 * `:entityType` is a path segment, so it is validated here before it reaches the
 * service (which indexes the catalog by it). An unknown module is a 400, not a
 * crash on `LIST_COLUMNS[undefined]`.
 */
function entityTypeOf(req: Request): ListEntityType {
  const raw = req.params.entityType;
  if (typeof raw !== 'string' || !isListEntityType(raw)) {
    throw ApiError.badRequest(`Unknown module. Expected one of: ${LIST_ENTITY_TYPES.join(', ')}.`);
  }
  return raw;
}

export const getListViewRoute = async (req: Request, res: Response) => {
  const data = await getListView(req.tenantId!, req.user!.id, entityTypeOf(req));
  sendSuccess(res, data);
};

export const saveListViewRoute = async (req: Request, res: Response) => {
  const { columns } = req.body as SaveListViewInput;
  const data = await saveListView(req.tenantId!, req.user!.id, entityTypeOf(req), columns);
  sendSuccess(res, data, 'Columns updated.');
};
