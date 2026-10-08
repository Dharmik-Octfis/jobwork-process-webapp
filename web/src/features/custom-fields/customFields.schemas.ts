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
  | 'multi_select';

export interface CustomFieldOption {
  id: string;
  label: string;
  order?: number;
}

export interface CustomFieldConfig {
  options?: CustomFieldOption[];
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
  displayOrder: number;
  status?: 'active' | 'hidden';
}

/** The value blob stored on a record (vendor/item) under `customFields`. */
export type CustomFieldValues = Record<string, unknown>;

/** Fixed length limit per string type — mirrors backend `TEXT_LENGTH_CAPS`
 * (customFields.constants.ts); keep the two in sync. */
export const TEXT_LENGTH_CAPS: Partial<Record<DataType, number>> = {
  text: 255,
  phone: 255,
  email: 255,
  url: 2048,
  textarea: 2000,
};

/** Data-type catalog for the admin type-picker. */
export const DATA_TYPE_OPTIONS: Array<{
  value: DataType;
  label: string;
  hasOptions?: boolean;
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

/**
 * Modules offered in Settings → Customization. Listed only when the module's form
 * renders `CustomFieldsSection` — a module with no input would let an admin define
 * a field nobody can fill in (why Rejection Reason, Batch and User are absent).
 *
 * 🔴 Order is the main sidebar's: Item, Inventory, Sales, Purchases, Jobwork, and
 * each group's children in their `app_modules` sort order (`prisma/seed.ts`).
 */
export const CUSTOM_FIELD_MODULES: Array<{
  entityType: string;
  label: string;
  description: string;
}> = [
  { entityType: 'item', label: 'Item', description: 'Add fields to the item create & edit form.' },
  {
    entityType: 'item_assembly',
    label: 'Assembly',
    description: 'Add fields to the assembly form.',
  },
  {
    entityType: 'stock_adjustment',
    label: 'Inventory Adjustment',
    description: 'Add fields to the inventory adjustment form.',
  },
  {
    entityType: 'customer',
    label: 'Customer',
    description: 'Add fields to the customer create & edit form.',
  },
  {
    entityType: 'sales_order',
    label: 'Sales Order',
    description: 'Add fields to the sales order create & edit form.',
  },
  {
    entityType: 'invoice',
    label: 'Invoice',
    description: 'Add fields to the invoice create & edit form.',
  },
  {
    entityType: 'vendor',
    label: 'Vendor',
    description: 'Add fields to the vendor create & edit form.',
  },
  {
    entityType: 'purchase_order',
    label: 'Purchase Order',
    description: 'Add fields to the purchase order create & edit form.',
  },
  {
    entityType: 'bill',
    label: 'Bill',
    description: 'Add fields to the bill create & edit form.',
  },
  {
    entityType: 'job_order',
    label: 'Job Order',
    description: 'Add fields to the job order form and its steps.',
  },
  {
    entityType: 'job_issue',
    label: 'Issue',
    description: 'Add fields to the issue (challan out) form.',
  },
  {
    entityType: 'job_receipt',
    label: 'Receipt',
    description: 'Add fields captured when goods come back from a processor.',
  },
];

/** Modules whose PDF/print template renders custom fields — the only place
 * `showInPrint` has an effect, so the toggle is offered for these alone. */
export const PRINTABLE_ENTITY_TYPES: readonly string[] = ['sales_order', 'purchase_order', 'bill'];

export function moduleLabel(entityType: string): string {
  return CUSTOM_FIELD_MODULES.find((m) => m.entityType === entityType)?.label ?? entityType;
}

/** Stable client-side option id, generated when an option is first added so the
 * backend preserves it and stored values / defaults never orphan on rename. */
export function generateOptionId(): string {
  return `opt_${Math.random().toString(36).slice(2, 10)}`;
}
