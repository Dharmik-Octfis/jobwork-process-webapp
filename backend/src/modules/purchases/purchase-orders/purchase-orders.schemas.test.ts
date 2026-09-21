import { describe, it, expect } from 'vitest';
import { createPurchaseOrderSchema, updatePurchaseOrderSchema } from './purchase-orders.schemas.ts';

/** Zod 4's `.partial()` keeps a `.default()`, so the update schema used to invent
 * `status: 'Draft'` and `deliveryType: 'Location'` for a PATCH that sent neither. */
describe('purchase order schemas — defaults belong to create only', () => {
  it('does not invent a status or delivery type for a PATCH that sends none', () => {
    const parsed = updatePurchaseOrderSchema.parse({ notes: 'Call before delivery' });
    expect(parsed.status).toBeUndefined();
    expect(parsed.deliveryType).toBeUndefined();
  });

  it('still defaults both on create', () => {
    const parsed = createPurchaseOrderSchema.parse({
      vendorId: '00000000-0000-4000-8000-000000000001',
      poNumber: 'PO-1',
      date: '2026-09-11',
      subTotal: 10,
      totalAmount: 10,
      lineItems: [
        { itemId: '00000000-0000-4000-8000-000000000002', quantity: 1, rate: 10, itemTotal: 10 },
      ],
    });
    expect(parsed.status).toBe('Draft');
    expect(parsed.deliveryType).toBe('Location');
  });
});
