import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { sendSuccess } from '../../../../lib/apiResponse.ts';
import {
  createItemCategory,
  updateItemCategory,
  deleteItemCategory,
  fetchItemCategories,
} from './item-categories.service.ts';
import {
  createItemCategorySchema,
  updateItemCategorySchema,
} from './item-categories.schemas.ts';

export async function createHandler(req: Request, res: Response) {
  const orgId = req.tenantId!;
  const userId = req.user?.id;
  const data = createItemCategorySchema.parse(req.body);

  const category = await createItemCategory(orgId, userId as string, data);
  sendSuccess(res, category, 'Item category created successfully', StatusCodes.CREATED);
}

export async function updateHandler(req: Request, res: Response) {
  const orgId = req.tenantId!;
  const categoryId = req.params.id as string;
  const userId = req.user?.id;
  const data = updateItemCategorySchema.parse(req.body);

  const category = await updateItemCategory(orgId, categoryId, userId as string, data);
  sendSuccess(res, category, 'Item category updated successfully');
}

export async function deleteHandler(req: Request, res: Response) {
  const orgId = req.tenantId!;
  const categoryId = req.params.id as string;
  const userId = req.user?.id;

  await deleteItemCategory(orgId, categoryId, userId as string);
  sendSuccess(res, null, 'Item category deleted successfully');
}

export async function listHandler(req: Request, res: Response) {
  const orgId = req.tenantId!;

  const categories = await fetchItemCategories(orgId);
  sendSuccess(res, categories);
}
