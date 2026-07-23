/**
 * Shared catalog for the dynamic custom-fields feature. Both the definition
 * service (which validates config) and the value engine (which validates saved
 * values) read from here, so the list of supported types lives in ONE place.
 */

/** Modules that support custom fields today. Extend as new entities gain them. */
export const ENTITY_TYPES = ['vendor', 'customer', 'item'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(value);
}

/** Every data type the engine knows how to store & validate. */
export const DATA_TYPES = [
  'text',
  'textarea',
  'number',
  'decimal',
  'checkbox',
  'date',
  'datetime',
  'time',
  'email',
  'url',
  'phone',
  'select',
  'multi_select',
  'attachment',
] as const;
export type DataType = (typeof DATA_TYPES)[number];

/** Types whose `config.options` drives the choices (value stores the option id). */
export const OPTION_TYPES: readonly DataType[] = ['select', 'multi_select'];

/**
 * `attachment` is defined so the type list is complete, but v1 cannot store or
 * render files, so the definition API refuses to create one. The UI greys it out.
 */
export const DISABLED_TYPES: readonly DataType[] = ['attachment'];

/** Field-definition status (visibility on the form). Archive = isDeleted. */
export const FIELD_STATUSES = ['active', 'hidden'] as const;
export type FieldStatus = (typeof FIELD_STATUSES)[number];

/** Cap on ACTIVE definitions per org per module. Enforced at create time. */
export const MAX_ACTIVE_FIELDS = 50;

/**
 * Turn a human label into an immutable, DB-safe key ("Truck Number" -> "truck_no"…
 * actually "truck_number"). Generated ONCE at create; never regenerated on rename.
 * Uniqueness (incl. archived rows) is resolved by the service, which may suffix _2.
 */
export function slugifyKey(label: string): string {
  let key = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  // A key must start with a letter/underscore so it is a valid identifier-ish slug.
  if (key && /^[0-9]/.test(key)) key = `f_${key}`;
  if (!key) key = 'field';

  return key.slice(0, 80);
}
