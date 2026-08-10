/** Frontend types + catalog for the dynamic custom-fields feature. Mirrors the
 * backend `customFields.constants.ts` — keep the two lists in sync. */

export type DataType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'decimal'
  | 'checkbox'
  | 'date'
  | 'datetime'
  | 'time'
  | 'email'
  | 'url'
  | 'phone'
  | 'select'
  | 'multi_select'
  | 'attachment';

export interface CustomFieldOption {
  id: string;
  label: string;
  order?: number;
}

export interface CustomFieldConfig {
  options?: CustomFieldOption[];
  maxLength?: number;
  min?: number;
  max?: number;
  precision?: number;
  regex?: string;
  helpText?: string;
  defaultValue?: unknown;
}

export interface CustomFieldDefinition {
  id: string;
  key: string;
  label: string;
  dataType: DataType;
  config: CustomFieldConfig;
  isRequired: boolean;
  showInPrint: boolean;
  showInList: boolean;
  displayOrder: number;
  status?: 'active' | 'hidden';
}

/** The value blob stored on a record (vendor/item) under `customFields`. */
export type CustomFieldValues = Record<string, unknown>;

/** Data-type catalog for the admin type-picker. `attachment` is disabled in v1. */
export const DATA_TYPE_OPTIONS: Array<{
  value: DataType;
  label: string;
  hasOptions?: boolean;
  disabled?: boolean;
}> = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Multi-line Text' },
  { value: 'number', label: 'Number' },
  { value: 'decimal', label: 'Decimal' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date & Time' },
  { value: 'time', label: 'Time' },
  { value: 'email', label: 'Email' },
  { value: 'url', label: 'URL' },
  { value: 'phone', label: 'Phone' },
  { value: 'select', label: 'Dropdown (select one)', hasOptions: true },
  { value: 'multi_select', label: 'Multi-select', hasOptions: true },
];

export function dataTypeLabel(value: DataType): string {
  return DATA_TYPE_OPTIONS.find((t) => t.value === value)?.label ?? value;
}

export function typeHasOptions(value: DataType): boolean {
  return DATA_TYPE_OPTIONS.find((t) => t.value === value)?.hasOptions ?? false;
}

/** Modules that support custom fields today. */
export const CUSTOM_FIELD_MODULES: Array<{
  entityType: string;
  label: string;
  description: string;
}> = [
  {
    entityType: 'vendor',
    label: 'Vendor',
    description: 'Add fields to the vendor create & edit form.',
  },
  {
    entityType: 'customer',
    label: 'Customer',
    description: 'Add fields to the customer create & edit form.',
  },
  { entityType: 'item', label: 'Item', description: 'Add fields to the item create & edit form.' },
  {
    entityType: 'process_route',
    label: 'Process Route',
    description: 'Add fields to the route create & edit form.',
  },
  {
    entityType: 'job_order',
    label: 'Job Order',
    description: 'Add fields to the job order form and its steps.',
  },
  {
    entityType: 'job_issue',
    label: 'Issue (Challan Out)',
    // This is where the mind map's "lot-wise pcs, cutper, meter" lands. One org's
    // cutper is another org's nothing, so it must never become a column.
    description: 'Add fields captured when material is issued to a processor.',
  },
  {
    entityType: 'job_receipt',
    label: 'Receipt',
    description: 'Add fields captured when goods come back from a processor.',
  },
  {
    entityType: 'rejection_reason',
    label: 'Rejection Reason',
    description: 'Add fields to the rejection reason master.',
  },
  {
    entityType: 'lot',
    label: 'Lot',
    // No list page — lots are picked from an availability query, never browsed —
    // but Material In creates one, and an org may need to record what its own tags
    // carry.
    description: 'Add fields recorded against a lot when material is taken in.',
  },
  {
    entityType: 'member',
    label: 'User',
    // Dragging rows in this module's field list sets their display order, which is
    // also the order the `cf:` columns appear in on Settings → Users.
    description: 'Add fields to a user’s record. Values are per-organization.',
  },
];

export function moduleLabel(entityType: string): string {
  return CUSTOM_FIELD_MODULES.find((m) => m.entityType === entityType)?.label ?? entityType;
}

/** Stable client-side option id, generated when an option is first added so the
 * backend preserves it and stored values / defaults never orphan on rename. */
export function generateOptionId(): string {
  return `opt_${Math.random().toString(36).slice(2, 10)}`;
}
