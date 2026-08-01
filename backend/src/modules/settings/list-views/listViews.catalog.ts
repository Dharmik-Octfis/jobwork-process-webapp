import type { EntityType } from '../customization/custom-fields/customFields.constants.ts';

/**
 * The list-column catalog — which columns a module's list CAN show, their
 * labels, and which are locked. Like `permissions.catalog.ts` this is CODE, not
 * tenant data: it changes when a developer ships a column, never by a customer.
 *
 * A LOCKED column is the row's identity (the name you click through on). It is
 * always shown, always first, and cannot be hidden or reordered — the picker
 * renders it with a lock instead of a checkbox, and the server re-asserts it on
 * save so a hand-crafted payload can't drop it.
 *
 * Per-org custom fields are NOT here — they're merged in at runtime from
 * `custom_field_definitions` under a `cf:` prefix (see listViews.service.ts), so
 * adding a custom field needs no code change.
 */
export interface ColumnDef {
  key: string;
  label: string;
  /** Always visible, always first, never reorderable. */
  locked?: boolean;
  /** Shown when the user has never customised this list. */
  defaultVisible?: boolean;
}

/** Prefix marking a column as a per-org custom field rather than a built-in. */
export const CUSTOM_FIELD_PREFIX = 'cf:';

export const LIST_COLUMNS: Record<EntityType, readonly ColumnDef[]> = {
  vendor: [
    { key: 'contactName', label: 'Name', locked: true },
    { key: 'companyName', label: 'Company Name', defaultVisible: true },
    { key: 'contactNumber', label: 'Vendor Number', defaultVisible: true },
    { key: 'phone', label: 'Work Phone', defaultVisible: true },
    { key: 'email', label: 'Email', defaultVisible: true },
    { key: 'mobile', label: 'Mobile Phone' },
    { key: 'currency', label: 'Currency' },
    { key: 'paymentTerms', label: 'Payment Terms' },
    { key: 'status', label: 'Status' },
    { key: 'notes', label: 'Remarks' },
    { key: 'createdAt', label: 'Created At' },
    { key: 'updatedAt', label: 'Last Modified' },
  ],
  customer: [
    { key: 'contactName', label: 'Name', locked: true },
    { key: 'companyName', label: 'Company Name', defaultVisible: true },
    { key: 'contactNumber', label: 'Customer Number', defaultVisible: true },
    { key: 'phone', label: 'Work Phone', defaultVisible: true },
    { key: 'email', label: 'Email', defaultVisible: true },
    { key: 'mobile', label: 'Mobile Phone' },
    { key: 'currency', label: 'Currency' },
    { key: 'paymentTerms', label: 'Payment Terms' },
    { key: 'status', label: 'Status' },
    { key: 'notes', label: 'Remarks' },
    { key: 'createdAt', label: 'Created At' },
    { key: 'updatedAt', label: 'Last Modified' },
  ],
  item: [
    { key: 'name', label: 'Name', locked: true },
    { key: 'sku', label: 'SKU', defaultVisible: true },
    { key: 'type', label: 'Type', defaultVisible: true },
    { key: 'unit', label: 'Unit', defaultVisible: true },
    { key: 'category', label: 'Category' },
    { key: 'hsnCode', label: 'HSN Code' },
    { key: 'createdAt', label: 'Created At' },
    { key: 'updatedAt', label: 'Last Modified' },
  ],
  /**
   * Users. `fullName` is the MEMBERSHIP's name — this organization's name for the
   * person, not their account name (see the `Membership` schema comment).
   *
   * Custom fields are appended after these at runtime, ordered by the
   * `display_order` an admin sets by dragging rows in Settings → Modules → Users.
   * That drag is what decides where a custom column lands in this table.
   */
  member: [
    { key: 'fullName', label: 'Name', locked: true },
    { key: 'email', label: 'Email', defaultVisible: true },
    { key: 'roleName', label: 'Role', defaultVisible: true },
    { key: 'permissionTemplateName', label: 'Profile', defaultVisible: true },
    { key: 'status', label: 'Status', defaultVisible: true },
    { key: 'phone', label: 'Phone' },
    { key: 'mobile', label: 'Mobile' },
    { key: 'dateOfBirth', label: 'Date of Birth' },
    { key: 'addedByName', label: 'Added By' },
    { key: 'joinedAt', label: 'Joined On' },
    { key: 'updatedAt', label: 'Last Modified' },
  ],
  purchase_order: [
    { key: 'purchaseorder_number', label: 'PO Number', locked: true },
    { key: 'vendor', label: 'Vendor', defaultVisible: true },
    { key: 'date', label: 'Date', defaultVisible: true },
    { key: 'delivery_date', label: 'Delivery Date', defaultVisible: true },
    { key: 'total', label: 'Amount', defaultVisible: true },
    { key: 'status', label: 'Status', defaultVisible: true },
    { key: 'payment_terms', label: 'Payment Terms' },
    { key: 'created_at', label: 'Created At' },
    { key: 'updated_at', label: 'Last Modified' },
  ],
};

/** The locked keys for an entity, in catalog order. */
export function lockedKeys(entityType: EntityType): string[] {
  return LIST_COLUMNS[entityType].filter((c) => c.locked).map((c) => c.key);
}

/** What a never-customised list shows: locked + defaultVisible, in catalog order. */
export function defaultVisibleKeys(entityType: EntityType): string[] {
  return LIST_COLUMNS[entityType].filter((c) => c.locked || c.defaultVisible).map((c) => c.key);
}
