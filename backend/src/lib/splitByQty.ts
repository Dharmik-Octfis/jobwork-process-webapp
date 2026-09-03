import { Prisma } from '../../generated/prisma/client.ts';

/**
 * 🔴 SPLIT A VALUE ACROSS PARTS BY QUANTITY, CONSERVING EVERY PAISA.
 *
 * The last part takes the REMAINDER rather than its own rounded share. Rounding
 * each share independently to four decimals loses fractions — three ways of
 * ₹100 is 33.3333 × 3 = ₹99.9999 — and the missing paisa is not a display
 * problem: the pot no longer equals what was posted, so "cost per metre" stops
 * reconciling with the ledger and no report can say why.
 *
 * Legitimate ONLY where every part is the same item in the same unit (§9.2.1).
 * Across items it would be the cross-unit ratio the domain refuses everywhere.
 *
 * 🔴 Shared rather than copied (2026-09-02). It lives here because job receipts
 * and item assemblies both need it and inventory must not import from jobwork —
 * and because two copies of a conservation invariant is one copy too many: the
 * bug it prevents is silent, and it would only ever be fixed in one of them.
 */
export function splitByQty(
  total: Prisma.Decimal,
  parts: readonly Prisma.Decimal[],
): Prisma.Decimal[] {
  if (parts.length === 0) return [];
  const zero = new Prisma.Decimal(0);
  const sum = parts.reduce((acc, part) => acc.plus(part), zero);
  // Nothing to weigh by — a value with no quantity behind it goes nowhere rather
  // than being spread evenly over rows that measured zero.
  if (sum.lessThanOrEqualTo(0)) return parts.map(() => zero);

  const shares: Prisma.Decimal[] = [];
  let assigned = zero;
  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1) {
      shares.push(total.minus(assigned));
      break;
    }
    const share = total.times(part).dividedBy(sum).toDecimalPlaces(4);
    shares.push(share);
    assigned = assigned.plus(share);
  }
  return shares;
}
