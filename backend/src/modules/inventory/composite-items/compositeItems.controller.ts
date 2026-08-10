import type { Request, Response } from 'express';
import { compositeItemsService } from './compositeItems.service.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import type { CreateCompositeComponentDto, UpdateCompositeComponentDto } from './compositeItems.schemas.ts';

export class CompositeItemsController {
  async getComponents(req: Request, res: Response) {
    sendSuccess(res, await compositeItemsService.findMany(req.params.itemId as string, req.tenantId!));
  }

  async getComponent(req: Request, res: Response) {
    sendSuccess(res, await compositeItemsService.findUnique(req.params.id as string, req.params.itemId as string, req.tenantId!));
  }

  async createComponent(req: Request, res: Response) {
    const component = await compositeItemsService.create(req.params.itemId as string, req.tenantId!, req.body as CreateCompositeComponentDto, req.user?.id);
    sendSuccess(res, component, 'Component created.', 201);
  }

  async updateComponent(req: Request, res: Response) {
    const component = await compositeItemsService.update(req.params.id as string, req.params.itemId as string, req.tenantId!, req.body as UpdateCompositeComponentDto, req.user?.id);
    sendSuccess(res, component, 'Component updated.');
  }

  async deleteComponent(req: Request, res: Response) {
    await compositeItemsService.delete(req.params.id as string, req.params.itemId as string, req.tenantId!, req.user?.id);
    sendSuccess(res, null, 'Component deleted.');
  }
}

export const compositeItemsController = new CompositeItemsController();
