import { z } from 'zod';
import { ApiError } from '../../lib/apiError.ts';
import type { TenantClient } from '../../db/prisma.ts';
import type { EntityType } from './customFields.constants.ts';

/**
 * The custom-field VALUE engine (the "meal"). Vendor & Item services call this
 * inside their runAsTenant transaction to validate the JSONB blob a record wants
 * to save, against that org's active field definitions (the "recipe").
 *
 * Storage rules baked in here:
 *  - values are keyed by the definition's immutable `key`;
 *  - unknown keys are dropped (never persisted) — no poisoning the column;
 *  - decimals are stored as STRINGS (JS floats corrupt money on round-trip);
 *  - select / multi_select store option IDS, never labels (labels are renameable);
 *  - required is enforced per policy (b): on create always; on update only if the
 *    field already held a value on that record — so old records stay editable.
 */

export interface FieldDefinition {
  key: string;
  label: string;
  dataType: string;
  config: unknown;
  isRequired: boolean;
}

interface FieldOption {
  id: string;
  label: string;
  order?: number;
}

type JsonRecord = Record<string, unknown>;

function optionIds(config: unknown): string[] {
  if (
    config &&
    typeof config === 'object' &&
    Array.isArray((config as { options?: unknown }).options)
  ) {
    return (config as { options: FieldOption[] }).options
      .map((o) => o?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  }
  return [];
}

function configNumber(config: unknown, key: 'min' | 'max' | 'maxLength'): number | undefined {
  if (config && typeof config === 'object') {
    const v = (config as Record<string, unknown>)[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** A value counts as "empty" only if truly absent. 0 and false are real answers. */
function valueIsEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/** Build a Zod validator for one field's value, from its dataType + config. */
function buildValueSchema(def: FieldDefinition): z.ZodTypeAny {
  const maxLength = configNumber(def.config, 'maxLength');
  const min = configNumber(def.config, 'min');
  const max = configNumber(def.config, 'max');

  const withText = (): z.ZodTypeAny => {
    let s = z.string();
    if (maxLength !== undefined) s = s.max(maxLength, `Must be ${maxLength} characters or fewer.`);
    return s;
  };

  const withNumber = (): z.ZodTypeAny => {
    let s = z.coerce.number().refine((n) => Number.isFinite(n), 'Enter a valid number.');
    if (min !== undefined) s = s.refine((n) => n >= min, `Must be at least ${min}.`);
    if (max !== undefined) s = s.refine((n) => n <= max, `Must be at most ${max}.`);
    return s;
  };

  switch (def.dataType) {
    case 'text':
    case 'textarea':
    case 'phone':
      return withText();
    case 'email':
      return z.email('Enter a valid email address.');
    case 'url':
      return z.url('Enter a valid URL.');
    case 'number':
      return withNumber();
    case 'decimal':
      // Accept a number or numeric string; ALWAYS persist as a string.
      return z
        .union([
          z.number(),
          z
            .string()
            .trim()
            .regex(/^-?\d+(\.\d+)?$/, 'Enter a valid number.'),
        ])
        .transform((v) => (typeof v === 'number' ? String(v) : v));
    case 'checkbox':
      return z.boolean();
    case 'date':
      return z.iso.date('Enter a valid date (YYYY-MM-DD).');
    case 'datetime':
      return z.iso.datetime({ message: 'Enter a valid date & time.', offset: true });
    case 'time':
      return z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Enter a valid time (HH:MM).');
    case 'select': {
      const ids = optionIds(def.config);
      return ids.length > 0
        ? z.string().refine((v) => ids.includes(v), 'Choose one of the available options.')
        : z.string();
    }
    case 'multi_select': {
      const ids = optionIds(def.config);
      const item =
        ids.length > 0
          ? z.string().refine((v) => ids.includes(v), 'Choose from the available options.')
          : z.string();
      return z.array(item);
    }
    default:
      // Unknown / disabled types (e.g. attachment) can't be validated — reject.
      return z.never();
  }
}

/** Active field definitions for an org+module, ordered for the form. */
export async function loadActiveDefinitions(
  tx: TenantClient,
  organizationId: string,
  entityType: EntityType,
): Promise<FieldDefinition[]> {
  return tx.customFieldDefinition.findMany({
    where: { organizationId, entityType, isDeleted: false, status: 'active' },
    orderBy: { displayOrder: 'asc' },
    select: { key: true, label: true, dataType: true, config: true, isRequired: true },
  });
}

/**
 * Validate & clean a record's custom field values against the active definitions.
 * Throws ApiError(400) with per-field messages, or returns the object to persist.
 */
export function validateCustomFields(params: {
  defs: FieldDefinition[];
  input: unknown;
  mode: 'create' | 'update';
  existing?: unknown;
}): JsonRecord {
  const { defs, mode } = params;
  const input: JsonRecord =
    params.input && typeof params.input === 'object' ? (params.input as JsonRecord) : {};
  const existing: JsonRecord =
    params.existing && typeof params.existing === 'object' ? (params.existing as JsonRecord) : {};

  const fieldErrors: Record<string, string> = {};
  const cleaned: JsonRecord = {};

  for (const def of defs) {
    const provided = Object.prototype.hasOwnProperty.call(input, def.key);
    const rawValue = provided ? input[def.key] : undefined;

    // Update with this active field omitted → keep whatever is already stored.
    if (!provided && mode === 'update' && Object.prototype.hasOwnProperty.call(existing, def.key)) {
      cleaned[def.key] = existing[def.key];
      continue;
    }

    if (valueIsEmpty(rawValue)) {
      // Required policy (b): create always enforces; update enforces only if the
      // field already had a value on this record.
      const wasFilled = !valueIsEmpty(existing[def.key]);
      if (def.isRequired && (mode === 'create' || wasFilled)) {
        fieldErrors[`customFields.${def.key}`] = `${def.label} is required.`;
      }
      // A cleared-on-purpose field records null ("existed, left blank"); a field
      // never touched on create is simply omitted ("didn't exist / not provided").
      if (provided) cleaned[def.key] = null;
      continue;
    }

    const parsed = buildValueSchema(def).safeParse(rawValue);
    if (!parsed.success) {
      fieldErrors[`customFields.${def.key}`] =
        parsed.error.issues[0]?.message ?? `${def.label} is invalid.`;
      continue;
    }
    cleaned[def.key] = parsed.data;
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw ApiError.badRequest('Please check the highlighted fields.', fieldErrors);
  }

  // Preserve values of non-active (hidden/archived) fields already on the record —
  // removing a field from the form must never delete its stored data.
  const activeKeys = new Set(defs.map((d) => d.key));
  const preserved: JsonRecord = {};
  for (const [k, v] of Object.entries(existing)) {
    if (!activeKeys.has(k)) preserved[k] = v;
  }

  return { ...preserved, ...cleaned };
}
