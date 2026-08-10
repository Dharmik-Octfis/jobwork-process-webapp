/**
 * The vocabularies a Process draws on. Kept here rather than as Prisma enums
 * because this codebase has zero enum blocks: a `String @db.VarChar(n)` with a
 * `// a | b | c` comment is the convention, and adding a value is then a code
 * change with no migration.
 */

/**
 * How the processor charges — domain doc §9.2. This decides WHICH quantity the
 * rate is multiplied by, so it cannot be inferred from anything else later:
 * 4,850 m received against 5,000 m issued is two different bills depending on the
 * answer.
 */
/// `per_kg` and `lump_sum` went on 2026-08-10. Both needed a number this system
/// does not hold: per_kg has no weight to multiply (it silently billed against
/// the received quantity whatever unit that was), and lump_sum ignored quantity
/// entirely, so a step that received nothing still billed in full. The two that
/// remain are the two the ledger can actually answer.
export const RATE_BASES = ['per_issued_unit', 'per_received_unit'] as const;
export type RateBasis = (typeof RATE_BASES)[number];

export function isRateBasis(value: string): value is RateBasis {
  return (RATE_BASES as readonly string[]).includes(value);
}

/** Labels for the dropdown. The frontend has its own copy for rendering; this
 * one exists so the API can describe itself in OpenAPI without a second list. */
export const RATE_BASIS_LABELS: Record<RateBasis, string> = {
  per_issued_unit: 'Per unit issued',
  per_received_unit: 'Per unit received',
};
