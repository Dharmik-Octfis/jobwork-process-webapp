import type { Request, Response } from 'express';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { getInventoryValuationSummary, getItemLedger as getItemLedgerService } from './inventoryValuation.service.ts';
import { inventoryValuationQuerySchema, itemLedgerQuerySchema } from './inventoryValuation.schemas.ts';

export async function getInventoryValuation(req: Request, res: Response) {
  const query = inventoryValuationQuerySchema.parse(req.query);
  const result = await getInventoryValuationSummary(req.tenantId!, query);
  
  sendSuccess(res, result);
}

export async function getItemLedger(req: Request, res: Response) {
  const query = itemLedgerQuerySchema.parse(req.query);
  const itemId = req.params.itemId as string;
  if (!itemId) {
    throw new Error('itemId is required');
  }
  const result = await getItemLedgerService(req.tenantId!, itemId, query);
  sendSuccess(res, result);
}

