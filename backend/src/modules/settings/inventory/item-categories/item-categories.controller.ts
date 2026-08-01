import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
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
  res.status(StatusCodes.CREATED).json(category);
}

export async function updateHandler(req: Request, res: Response) {
  const orgId = req.tenantId!;
  const categoryId = req.params.id as string;
  const userId = req.user?.id;
  const data = updateItemCategorySchema.parse(req.body);

  const category = await updateItemCategory(orgId, categoryId, userId as string, data);
  res.status(StatusCodes.OK).json(category);
}

export async function deleteHandler(req: Request, res: Response) {
  const orgId = req.tenantId!;
  const categoryId = req.params.id as string;
  const userId = req.user?.id;

  await deleteItemCategory(orgId, categoryId, userId as string);
  res.status(StatusCodes.NO_CONTENT).send();
}

export async function listHandler(req: Request, res: Response) {
  const orgId = req.tenantId!;

  const categories = await fetchItemCategories(orgId);
  res.status(StatusCodes.OK).json(categories);
}
