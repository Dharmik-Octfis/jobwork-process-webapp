import type { Request, Response } from 'express';
import { itemsService } from './items.service.ts';
import { createItemSchema, updateItemSchema } from './items.schemas.ts';
import { z } from 'zod';

export class ItemsController {
  async getItems(req: Request, res: Response) {
    try {
      const organizationId = req.tenantId!;
      const items = await itemsService.findMany(organizationId);
      res.json(items);
    } catch (error) {
      console.error('Error fetching items:', error);
      res.status(500).json({ error: 'Failed to fetch items' });
    }
  }

  async getItem(req: Request, res: Response) {
    try {
      const organizationId = req.tenantId!;
      const id = req.params.id as string;
      const item = await itemsService.findUnique(id, organizationId);
      res.json(item);
    } catch (error) {
      if (error instanceof Error && error.message === 'Item not found') {
        res.status(404).json({ error: error.message });
      } else {
        console.error('Error fetching item:', error);
        res.status(500).json({ error: 'Failed to fetch item' });
      }
    }
  }

  async getItemActivities(req: Request, res: Response) {
    try {
      const organizationId = req.tenantId!;
      const id = req.params.id as string;
      const activities = await itemsService.getActivities(id, organizationId);
      res.json(activities);
    } catch (error) {
      if (error instanceof Error && error.message === 'Item not found') {
        res.status(404).json({ error: error.message });
      } else {
        console.error('Error fetching item activities:', error);
        res.status(500).json({ error: 'Failed to fetch item activities' });
      }
    }
  }

  async createItem(req: Request, res: Response) {
    try {
      const organizationId = req.tenantId!;
      const data = createItemSchema.parse(req.body);
      const item = await itemsService.create(organizationId, data, req.user?.id);
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation error', details: error.issues });
      } else {
        console.error('Error creating item:', error);
        res.status(500).json({ error: 'Failed to create item' });
      }
    }
  }

  async updateItem(req: Request, res: Response) {
    try {
      const organizationId = req.tenantId!;
      const id = req.params.id as string;
      const data = updateItemSchema.parse(req.body);
      const item = await itemsService.update(id, organizationId, data, req.user?.id);
      res.json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation error', details: error.issues });
      } else if (error instanceof Error && error.message === 'Item not found') {
        res.status(404).json({ error: error.message });
      } else {
        console.error('Error updating item:', error);
        res.status(500).json({ error: 'Failed to update item' });
      }
    }
  }

  async deleteItem(req: Request, res: Response) {
    try {
      const organizationId = req.tenantId!;
      const id = req.params.id as string;
      await itemsService.delete(id, organizationId, req.user?.id);
      res.status(204).send();
    } catch (error) {
      if (error instanceof Error && error.message === 'Item not found') {
        res.status(404).json({ error: error.message });
      } else {
        console.error('Error deleting item:', error);
        res.status(500).json({ error: 'Failed to delete item' });
      }
    }
  }
  async uploadImages(req: Request, res: Response) {
    try {
      const organizationId = req.tenantId!;
      const id = req.params.id as string;
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };

      if (!files) {
         res.status(400).json({ error: 'No files provided' });
         return;
      }

      const item = await itemsService.uploadImages(id, organizationId, files, req.user?.id);
      res.json(item);
    } catch (error) {
      if (error instanceof Error && error.message === 'Item not found') {
        const organizationId = req.tenantId!;
        const id = req.params.id as string;
        res.status(404).json({ error: error.message, debug: { orgId: organizationId, itemId: id } });
      } else {
        console.error('Error uploading item images:', error);
        res.status(500).json({ error: 'Failed to upload item images', details: error instanceof Error ? error.message : String(error) });
      }
    }
  }
}

export const itemsController = new ItemsController();
