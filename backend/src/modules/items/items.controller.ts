import type { Request, Response } from 'express';
import { itemsService } from './items.service.ts';
import { ApiError } from '../../lib/apiError.ts';
import { sendSuccess } from '../../lib/apiResponse.ts';
import { listQuerySchema } from '../../lib/pagination.ts';
import type { CreateItemDto, UpdateItemDto } from './items.schemas.ts';

/**
 * Happy path only — no try/catch. The route validates the body, the service
 * throws `ApiError` (404, and custom-field 400s with `details`), and
 * `errorHandler` formats whatever is thrown.
 * See CLAUDE.md "API responses — one envelope, one error path".
 */
export class ItemsController {
  async getItems(req: Request, res: Response) {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
    sendSuccess(res, await itemsService.findMany(req.tenantId!, parsed.data));
  }

  async getItem(req: Request, res: Response) {
    sendSuccess(res, await itemsService.findUnique(req.params.id as string, req.tenantId!));
  }

  async getItemActivities(req: Request, res: Response) {
    sendSuccess(res, await itemsService.getActivities(req.params.id as string, req.tenantId!));
  }

  async createItem(req: Request, res: Response) {
    const item = await itemsService.create(req.tenantId!, req.body as CreateItemDto, req.user?.id);
    sendSuccess(res, item, 'Item created.', 201);
  }

  async updateItem(req: Request, res: Response) {
    const item = await itemsService.update(
      req.params.id as string,
      req.tenantId!,
      req.body as UpdateItemDto,
      req.user?.id,
    );
    sendSuccess(res, item, 'Item updated.');
  }

  async deleteItem(req: Request, res: Response) {
    await itemsService.delete(req.params.id as string, req.tenantId!, req.user?.id);
    sendSuccess(res, null, 'Item deleted.');
  }

  async uploadImages(req: Request, res: Response) {
    // multipart — validateBody cannot cover this, so the check stays here.
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    if (!files) throw ApiError.badRequest('No files provided');

    const item = await itemsService.uploadImages(
      req.params.id as string,
      req.tenantId!,
      files,
      req.user?.id,
    );
    sendSuccess(res, item, 'Images uploaded.');
  }

  async getSignedUrl(req: Request, res: Response) {
    const { key } = req.query;
    if (!key || typeof key !== 'string') {
      throw ApiError.badRequest('Missing or invalid key');
    }
    // The key must live under this tenant's prefix — otherwise a member of one
    // org could mint a URL for another org's file.
    const organizationId = req.tenantId!;
    if (!key.startsWith(`items/${organizationId}/`)) {
      throw new ApiError(403, 'Forbidden');
    }

    const { getFileUrl } = await import('../../lib/storage.ts');
    const url = await getFileUrl(key);
    sendSuccess(res, { url });
  }
}

export const itemsController = new ItemsController();
