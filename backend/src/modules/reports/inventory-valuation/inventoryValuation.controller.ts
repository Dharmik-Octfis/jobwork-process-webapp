import type { Request, Response } from 'express';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { getInventoryValuationSummary } from './inventoryValuation.service.ts';
import { inventoryValuationQuerySchema } from './inventoryValuation.schemas.ts';

export async function getInventoryValuation(req: Request, res: Response) {
  const query = inventoryValuationQuerySchema.parse(req.query);
  const rows = await getInventoryValuationSummary(req.tenantId!, query);
  
  // Apply stock availability filters if needed, though they could also be pushed into SQL
  let filteredRows = rows;
  if (query.stockAvailability === 'gt') {
    filteredRows = rows.filter(r => r.stockOnHand > 0);
  } else if (query.stockAvailability === 'lt') {
    filteredRows = rows.filter(r => r.stockOnHand < 0);
  } else if (query.stockAvailability === 'eq') {
    filteredRows = rows.filter(r => r.stockOnHand === 0);
  } else if (query.stockAvailability === 'neq') {
    filteredRows = rows.filter(r => r.stockOnHand !== 0);
  } else if (query.stockAvailability === 'lte') {
    filteredRows = rows.filter(r => r.stockOnHand <= 0);
  }

  sendSuccess(res, filteredRows);
}
