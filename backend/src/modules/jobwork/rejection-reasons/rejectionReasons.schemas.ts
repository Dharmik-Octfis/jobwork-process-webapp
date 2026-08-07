import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';
import { RESPONSIBILITIES } from '../jobwork.types.ts';

/**
 * Rejection reasons — a small per-org master.
 *
 * It has to BE a master rather than a text box on the receipt: free text cannot
 * be GROUPED, and "which defect is costing us the most" is the entire reason for
 * recording a reason (plan §2). "shade off", "Shade Off", "shade-off" and
 * "shd off" are four rows in that report and one problem on the floor.
 */
export const createRejectionReasonSchema = openApiRegistry.register(
  'CreateRejectionReasonRequest',
  z.object({
    name: z.string().trim().min(1, 'Reason is required.').max(150),
    code: z.string().trim().max(50).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    /** Pre-fills the receipt line. A DEFAULT, never a rule — the same defect can
     * be either side's fault, and what gets billed is decided per line. */
    defaultResponsibility: z.enum(RESPONSIBILITIES).nullable().optional(),
    isActive: z.boolean().optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
  }),
);

export type CreateRejectionReasonInput = z.infer<typeof createRejectionReasonSchema>;
export const updateRejectionReasonSchema = createRejectionReasonSchema;
