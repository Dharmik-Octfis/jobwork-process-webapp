import {
  ENTITY_TYPES,
  isEntityType,
  type EntityType,
} from '../customization/custom-fields/customFields.constants.ts';

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

/**
 * 🔴 Modules that have a LIST but no CUSTOM FIELDS.
 *
 * `ENTITY_TYPES` (customFields.constants.ts) used to drive this file too, which
 * silently conflated two different questions: "can this module's list be
 * customised?" and "can an admin add per-org fields to it?". They are not the
 * same. `permission_templates` has no `custom_fields` column — it is not a domain
 * table (see CLAUDE.md's exclusion list) — so putting it in `ENTITY_TYPES` would
 * have listed it in Settings → Modules and let an admin define a field the write
 * path cannot store.
 *
 * So the two sets are separate and this one is the superset. Add a module here
 * when it needs Customize Columns and nothing else; add it to `ENTITY_TYPES` only
 * when the table actually carries `custom_fields`.
 */
export const LIST_ONLY_ENTITY_TYPES = ['permission_template'] as const;

export const LIST_ENTITY_TYPES = [...ENTITY_TYPES, ...LIST_ONLY_ENTITY_TYPES] as const;
export type ListEntityType = (typeof LIST_ENTITY_TYPES)[number];

export function isListEntityType(value: string): value is ListEntityType {
  return (LIST_ENTITY_TYPES as readonly string[]).includes(value);
}

/** True when this module stores per-org custom fields, i.e. its catalog gets
 * `cf:` columns merged in. Narrows so the caller can index the custom-field
 * tables with it. */
export function supportsCustomFields(entityType: ListEntityType): entityType is EntityType {
  return isEntityType(entityType);
}
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

export const LIST_COLUMNS: Record<ListEntityType, readonly ColumnDef[]> = {
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
  /**
   * Permission templates — Settings → Permissions, labelled "profiles" in the UI
   * because that is what an admin calls the thing they put a person on.
   *
   * `createdBy` / `updatedBy` each render as attribution AND timestamp in one cell
   * ("Priya Shah · 20 Jul 2026"), which is why there is no separate `createdAt`
   * column here — who changed a permission set and when are read together or not
   * at all. The name comes from the org's member directory, so it is this
   * organization's name for the person (`lib/memberDirectory.ts`).
   */
  permission_template: [
    { key: 'name', label: 'Profile Name', locked: true },
    { key: 'description', label: 'Profile Description', defaultVisible: true },
    { key: 'createdBy', label: 'Created By & Time', defaultVisible: true },
    { key: 'updatedBy', label: 'Modified By & Time', defaultVisible: true },
    { key: 'memberCount', label: 'Members' },
    { key: 'permissionCount', label: 'Permissions' },
    { key: 'type', label: 'Type' },
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
export function lockedKeys(entityType: ListEntityType): string[] {
  return LIST_COLUMNS[entityType].filter((c) => c.locked).map((c) => c.key);
}

/** What a never-customised list shows: locked + defaultVisible, in catalog order. */
export function defaultVisibleKeys(entityType: ListEntityType): string[] {
  return LIST_COLUMNS[entityType].filter((c) => c.locked || c.defaultVisible).map((c) => c.key);
}
