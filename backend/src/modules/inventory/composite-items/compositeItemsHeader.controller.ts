import type { Request, Response } from 'express';
import { compositeItemsService } from './compositeItems.service.ts';
import { itemsService } from '../../items/items.service.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import type { CreateCompositeItemDto, UpdateCompositeItemDto } from './compositeItems.schemas.ts';
import { listQuerySchema } from '../../../lib/pagination.ts';

export class CompositeItemsHeaderController {
  async getItems(req: Request, res: Response) {
    const opts = listQuerySchema.parse(req.query);
    const [results, count] = await Promise.all([
      compositeItemsService.findManyItems(req.tenantId!, opts),
      req.query.count ? compositeItemsService.countItems(req.tenantId!, opts) : undefined,
    ]);

    sendSuccess(res, { ...results, count });
  }

  async getItem(req: Request, res: Response) {
    sendSuccess(res, await compositeItemsService.findUniqueItem(req.params.id as string, req.tenantId!));
  }

  async createItem(req: Request, res: Response) {
    const item = await compositeItemsService.createItem(
      req.tenantId!,
      req.body as CreateCompositeItemDto,
      req.user?.id,
    );
    sendSuccess(res, item, 'Composite Item created.', 201);
  }

  async updateItem(req: Request, res: Response) {
    const item = await compositeItemsService.updateItem(
      req.params.id as string,
      req.tenantId!,
      req.body as UpdateCompositeItemDto,
      req.user?.id,
    );
    sendSuccess(res, item, 'Composite Item updated.');
  }

  async deleteItem(req: Request, res: Response) {
    // Delete for composite items is exactly the same as for regular items.
    // itemsService.delete will correctly verify there are no active recipes where this item is a component.
    await itemsService.delete(req.params.id as string, req.tenantId!, req.user?.id);
    sendSuccess(res, null, 'Composite Item deleted.');
  }
}

export const compositeItemsHeaderController = new CompositeItemsHeaderController();
