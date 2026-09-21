import { z } from 'zod';

/**
 * One BATCH ALLOCATION under a component line — which batch this component comes
 * out of, and how much of it.
 *
 * 🔴 A component often needs several. A required 500 M against batches of 300 M
 * and 250 M has no single-batch answer, so the user picks batches and the amounts
 * follow. Each allocation becomes one `item_assembly_lines` row, which is what
 * that table means: one (component × batch), never one per component.
 */
export const assemblyBatchAllocationSchema = z.object({
  batchId: z.string().uuid(),
  /**
   * 🔴 WHICH PACKAGE of that batch — a taka, roll or bale — when the org runs a
   * unit level. Omitted, the allocation draws on the batch's untagged remainder.
   *
   * 🔴 PARTIAL IS ALLOWED HERE, unlike on a job issue, and the difference is
   * physical: an issue sends the roll to the processor so the whole roll travels,
   * while an assembly consumes material where it stands. Cutting 20 m off a 100 m
   * roll is the ordinary case, and a recipe requirement is a quantity rather than
   * a count of rolls — so `qty` stands on its own and this only says which roll
   * it came off.
   */
  batchUnitId: z.string().uuid().nullable().optional(),
  qty: z.coerce.number().positive('Every batch row needs a quantity above zero.'),
});

export const itemAssemblyLineSchema = z.object({
  id: z.string().uuid().optional(),
  itemId: z.string().uuid(),
  qtyRequired: z.number().min(0),
  /**
   * 🔴 WHICH BATCHES THIS COMPONENT COMES OUT OF.
   *
   * Omitted, the server allocates FIFO out of what is actually at the assembly's
   * location — the same fallback job issues use for an item with no picker. Given,
   * the allocations must add up to `qtyRequired`: the user picked batches, and the
   * quantity is not theirs to disagree with.
   */
  batches: z.array(assemblyBatchAllocationSchema).optional(),
  /** Legacy single-batch form, kept so a client that sends one still works. Read
   * as a one-row `batches` covering the whole requirement. */
  batchId: z.string().uuid().optional(),
  /**
   * What one unit of a NON-STOCK line is worth — a service, or an item the org
   * does not track. Such a line posts no movement (there is no stock to move), so
   * this is the only way its cost reaches the composite, via `additionalCost`.
   */
  unitValue: z.coerce.number().min(0).optional(),
});

export const createAssemblySchema = z.object({
  compositeItemId: z.string().uuid(),
  assemblyNumber: z.string().optional(),
  remarks: z.string().optional(),
  assemblyDate: z.string().datetime({ offset: true }).or(z.string()),
  qty: z.number().min(1),
  locationId: z.string().uuid(),
  projectId: z.string().uuid().optional().or(z.literal('')),
  /**
   * The label for the batch this assembly CREATES. Required when the composite
   * item is batch-tracked — `createBatch` refuses a tracked batch without one,
   * because a batch nobody can name is a row no picker can offer.
   */
  compositeBatchRef: z.string().trim().max(100).nullable().optional(),
  /**
   * The packages the composite comes OUT as — ten shirts boxed into two cartons.
   * Same shape and the same rules as a receipt's: their quantities may total less
   * than the assembly's own, and the rest is the batch's untagged remainder.
   */
  compositeUnits: z
    .array(
      z.object({
        /** Optional since 2026-09-03 — an unnamed carton is auto-named `#seq`. */
        label: z.string().trim().max(60).optional(),
        qty: z.coerce.number().positive('Every unit needs a quantity above zero.'),
      }),
    )
    .optional(),
  lines: z.array(itemAssemblyLineSchema).min(1),
});

export type AssemblyBatchAllocation = z.infer<typeof assemblyBatchAllocationSchema>;
export type AssemblyLineDto = z.infer<typeof itemAssemblyLineSchema>;
export type CreateAssemblyDto = z.infer<typeof createAssemblySchema>;
