import { Prisma } from '../../generated/prisma/client.ts';
import { ApiError } from './apiError.ts';

interface PricedInput {
  quantity: number;
  rate: number;
  discountPercentage?: number | null;
  discount?: number | null;
}

/**
 * Line and document totals are derived here, never taken from the client: an order
 * whose lines did not sum to its total was only as correct as whoever sent it.
 * A percentage wins over an amount; an amount above the line's value is refused.
 */
export function priceLines<T extends PricedInput>(lineItems: T[]) {
  let subTotal = new Prisma.Decimal(0);
  let totalAmount = new Prisma.Decimal(0);
  const lines = lineItems.map((line, index) => {
    const gross = new Prisma.Decimal(line.quantity).times(line.rate).toDecimalPlaces(2);
    const discount =
      line.discountPercentage != null
        ? gross.times(line.discountPercentage).dividedBy(100).toDecimalPlaces(2)
        : new Prisma.Decimal(line.discount ?? 0).toDecimalPlaces(2);
    if (discount.greaterThan(gross)) {
      throw ApiError.badRequest('Discount cannot exceed the line amount.', {
        [`lineItems.${index}.discount`]: 'Discount cannot exceed the line amount.',
      });
    }
    const itemTotal = gross.minus(discount);
    subTotal = subTotal.plus(gross);
    totalAmount = totalAmount.plus(itemTotal);
    return { ...line, discount, itemTotal };
  });
  return { lines, subTotal, totalAmount };
}
