import { describe, it, expect } from 'vitest';
import { priceLines } from './purchase-orders.service.ts';
import { purchaseOrderItemSchema } from './purchase-orders.schemas.ts';
import { ApiError } from '../../../lib/apiError.ts';

const ITEM = '00000000-0000-4000-8000-000000000002';
const line = (extra: Record<string, unknown>) =>
  purchaseOrderItemSchema.parse({ itemId: ITEM, quantity: 1, rate: 100, ...extra });

describe('priceLines — the server owns PO totals', () => {
  it('applies a percentage and ignores the client amount and totals', () => {
    const { lines, subTotal, totalAmount } = priceLines([
      line({ quantity: 2, discountPercentage: 10, discount: 999, itemTotal: 1 }),
    ]);
    expect(lines[0]!.discount.toString()).toBe('20');
    expect(lines[0]!.itemTotal.toString()).toBe('180');
    expect(subTotal.toString()).toBe('200');
    expect(totalAmount.toString()).toBe('180');
  });

  it('applies a fixed amount when no percentage is set', () => {
    const { lines, totalAmount } = priceLines([line({ discount: 25 }), line({})]);
    expect(lines[0]!.itemTotal.toString()).toBe('75');
    expect(totalAmount.toString()).toBe('175');
  });

  it('refuses a fixed amount above the line, rather than flooring it', () => {
    expect(() => priceLines([line({ discount: 150 }), line({})])).toThrow(ApiError);
  });

  it('refuses a negative discount or a percentage above 100 at the schema', () => {
    expect(() => line({ discount: -5 })).toThrow();
    expect(() => line({ discountPercentage: 101 })).toThrow();
  });
});
