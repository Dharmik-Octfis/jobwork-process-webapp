import { z } from 'zod';
import {
  DATA_TYPES,
  DISABLED_TYPES,
  ENTITY_TYPES,
  FIELD_STATUSES,
  OPTION_TYPES,
  type DataType,
} from './customFields.constants.ts';

/**
 * Validation for the field-DEFINITION admin API (the "recipe"). The value engine
 * (customFields.engine.ts) validates the "meal" separately at record save time.
 */

const entityTypeSchema = z.enum(ENTITY_TYPES);

// A dropdown option as the admin sends it. `id` is optional on input — the service
// assigns a stable id to any option missing one and preserves existing ids on edit,
// so renaming a label never orphans stored values (which reference the id).
const optionInputSchema = z.object({
  id: z.string().max(40).optional(),
  label: z.string().trim().min(1, 'Option label is required').max(100),
  order: z.number().int().optional(),
});

// `config` is polymorphic per dataType; keep it permissive here and cross-check it
// against dataType in the superRefine below.
const configSchema = z
  .object({
    options: z.array(optionInputSchema).optional(),
    maxLength: z.number().int().positive().max(10000).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    precision: z.number().int().min(0).max(10).optional(),
    regex: z.string().max(300).optional(),
    // Zoho-Books-style extras, stored in the JSONB config (no schema migration).
    helpText: z.string().max(500).optional(),
    defaultValue: z.unknown().optional(),
  })
  .strip();

const baseFields = {
  label: z.string().trim().min(1, 'Label is required').max(150),
  config: configSchema.optional().default({}),
  isRequired: z.boolean().optional().default(false),
  showInPrint: z.boolean().optional().default(true),
  showInList: z.boolean().optional().default(false),
};

/** Cross-check that config matches the chosen dataType. */
function refineConfig(
  data: { dataType: DataType; config?: { options?: unknown[] } },
  ctx: z.RefinementCtx,
): void {
  if ((DISABLED_TYPES as readonly string[]).includes(data.dataType)) {
    ctx.addIssue({
      code: 'custom',
      path: ['dataType'],
      message: `The "${data.dataType}" field type is coming soon and can't be added yet.`,
    });
    return;
  }

  const needsOptions = (OPTION_TYPES as readonly string[]).includes(data.dataType);
  const options = data.config?.options ?? [];
  if (needsOptions && options.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['config', 'options'],
      message: 'Add at least one option for a dropdown / multi-select field.',
    });
  }
}

export const createDefinitionSchema = z
  .object({
    entityType: entityTypeSchema,
    dataType: z.enum(DATA_TYPES),
    ...baseFields,
  })
  .superRefine(refineConfig);

// Update never changes `key`, `dataType`, or `entityType` — those are immutable.
export const updateDefinitionSchema = z.object({
  label: z.string().trim().min(1).max(150).optional(),
  config: configSchema.optional(),
  isRequired: z.boolean().optional(),
  showInPrint: z.boolean().optional(),
  showInList: z.boolean().optional(),
  status: z.enum(FIELD_STATUSES).optional(),
});

export const reorderSchema = z.object({
  items: z
    .array(z.object({ id: z.string().uuid(), displayOrder: z.number().int() }))
    .min(1, 'Nothing to reorder.'),
});

export type CreateDefinitionInput = z.infer<typeof createDefinitionSchema>;
export type UpdateDefinitionInput = z.infer<typeof updateDefinitionSchema>;
export type ReorderInput = z.infer<typeof reorderSchema>;
