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
 *
 * `process`, `process_route` and `job_issue` are here rather than in
 * `ENTITY_TYPES` for a different reason: all three tables DO carry
 * `custom_fields`, but nothing fills it in any more (all removed 2026-08-10) —
 * the two masters are set up once and rarely revisited, and the Issue dialog lost
 * its "Additional fields" section. The columns stay, with whatever they already
 * hold; the modules are simply no longer offered in Settings → Modules. Their
 * lists still need Customize Columns, which is exactly what this set is for.
 */
export const LIST_ONLY_ENTITY_TYPES = [
  'permission_template',
  'process',
  'process_route',
  'job_issue',
] as const;

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
  /**
   * Processes — the jobwork operation master. `rateBasis` and `itemChanges` are
   * default-visible on purpose: they are not decoration, they decide what a later
   * step is allowed to charge and whether a different item comes back, so someone
   * scanning this list needs to see them without opening each row.
   *
   * No `cf:` columns are merged into this one — `process` is list-only now
   * (LIST_ONLY_ENTITY_TYPES above).
   */
  process: [
    { key: 'name', label: 'Process Name', locked: true },
    { key: 'code', label: 'Code', defaultVisible: true },
    { key: 'rateBasis', label: 'Rate Basis', defaultVisible: true },
    { key: 'itemChanges', label: 'Changes Item', defaultVisible: true },
    { key: 'defaultTolerancePct', label: 'Tolerance %' },
    { key: 'description', label: 'Description' },
    { key: 'createdAt', label: 'Created At' },
    { key: 'updatedAt', label: 'Last Modified' },
  ],
  /**
   * Process routes. `stepCount` and `firstProcess` are default-visible because
   * the only question anyone asks of a route list is "which one is this" — and a
   * route's identity is its sequence, not its name.
   *
   * No `cf:` columns are merged into this one — `process_route` is list-only now
   * (LIST_ONLY_ENTITY_TYPES above).
   */
  process_route: [
    { key: 'name', label: 'Route Name', locked: true },
    { key: 'code', label: 'Code', defaultVisible: true },
    { key: 'stepCount', label: 'Steps', defaultVisible: true },
    { key: 'stepSummary', label: 'Sequence', defaultVisible: true },
    { key: 'description', label: 'Description' },
    { key: 'createdAt', label: 'Created At' },
    { key: 'updatedAt', label: 'Last Modified' },
  ],
  /**
   * Job orders. `status` is default-visible and non-negotiable in practice: this
   * list is a work queue, and a queue that does not say what is running is a
   * directory.
   */
  job_order: [
    { key: 'jobOrderNumber', label: 'Job Order #', locked: true },
    { key: 'orderDate', label: 'Date', defaultVisible: true },
    { key: 'inputItem', label: 'Item', defaultVisible: true },
    { key: 'inputQty', label: 'Quantity', defaultVisible: true },
    { key: 'routeNameSnapshot', label: 'Route', defaultVisible: true },
    { key: 'status', label: 'Status', defaultVisible: true },
    { key: 'ownership', label: 'Ownership' },
    { key: 'targetDate', label: 'Target Date' },
    { key: 'stepCount', label: 'Steps' },
    { key: 'remarks', label: 'Remarks' },
    { key: 'createdAt', label: 'Created At' },
    { key: 'updatedAt', label: 'Last Modified' },
  ],
  /**
   * Issues — the challans out. Ordered the way someone chases material: number,
   * who has it, how much, when it went.
   *
   * No `cf:` columns are merged into this one — `job_issue` is list-only now
   * (LIST_ONLY_ENTITY_TYPES above). Vehicle No and E-way Bill went with the
   * columns themselves on 2026-08-10.
   */
  job_issue: [
    { key: 'challanNumber', label: 'Challan #', locked: true },
    { key: 'issueDate', label: 'Date', defaultVisible: true },
    { key: 'jobOrderNumber', label: 'Job Order', defaultVisible: true },
    { key: 'processorName', label: 'Processor', defaultVisible: true },
    { key: 'item', label: 'Item', defaultVisible: true },
    { key: 'totalQty', label: 'Quantity', defaultVisible: true },
    { key: 'status', label: 'Status', defaultVisible: true },
    { key: 'processName', label: 'Process' },
    { key: 'sourceLocation', label: 'From' },
    { key: 'destinationLocation', label: 'To' },
    { key: 'isRework', label: 'Rework' },
    { key: 'createdAt', label: 'Created At' },
  ],
  /** Receipts. The disposition columns are the reason anyone opens this list. */
  job_receipt: [
    { key: 'receiptNumber', label: 'Receipt #', locked: true },
    { key: 'receiptDate', label: 'Date', defaultVisible: true },
    { key: 'jobOrderNumber', label: 'Job Order', defaultVisible: true },
    { key: 'processorName', label: 'Processor', defaultVisible: true },
    { key: 'outputItem', label: 'Output Item', defaultVisible: true },
    { key: 'totalReceivedQty', label: 'Received', defaultVisible: true },
    { key: 'totalAcceptedQty', label: 'Accepted', defaultVisible: true },
    { key: 'totalReworkQty', label: 'Rework' },
    { key: 'totalScrapQty', label: 'Scrap' },
    { key: 'totalReturnedQty', label: 'Returned' },
    { key: 'mode', label: 'Mode' },
    { key: 'status', label: 'Status', defaultVisible: true },
    { key: 'createdAt', label: 'Created At' },
  ],
  rejection_reason: [
    { key: 'name', label: 'Reason', locked: true },
    { key: 'code', label: 'Code', defaultVisible: true },
    { key: 'defaultResponsibility', label: 'Usually', defaultVisible: true },
    { key: 'description', label: 'Description' },
    { key: 'createdAt', label: 'Created At' },
  ],
  /**
   * Batches. There is no batch LIST PAGE — batches are picked from an availability query
   * over the ledger, never browsed (§10) — but the catalog has to exist because
   * `LIST_COLUMNS` is keyed by every entity type that supports custom fields, and
   * batches do. It also gives the read-only batches endpoint a column vocabulary.
   *
   * 🔴 There is no `availableQty` column here on purpose. Availability is a
   * ledger SUM, never a column on the batch, and offering it as one would be the
   * first step towards someone storing it.
   */
  batch: [
    { key: 'batchNumber', label: 'Batch #', locked: true },
    { key: 'item', label: 'Item', defaultVisible: true },
    { key: 'supplierBatchRef', label: 'Supplier Ref', defaultVisible: true },
    { key: 'ownership', label: 'Ownership', defaultVisible: true },
    { key: 'state', label: 'State', defaultVisible: true },
    { key: 'packageCount', label: 'Takas' },
    { key: 'createdAt', label: 'Created At', defaultVisible: true },
  ],
  composite_item_component: [{ key: 'id', label: 'ID', locked: true }],
  item_assembly: [
    { key: 'assemblyNumber', label: 'Assembly #', locked: true },
    { key: 'assemblyDate', label: 'Date', defaultVisible: true },
    { key: 'compositeItem', label: 'Composite Item', defaultVisible: true },
    { key: 'qty', label: 'Quantity', defaultVisible: true },
    { key: 'totalValue', label: 'Total', defaultVisible: true },
    { key: 'status', label: 'Status', defaultVisible: true },
    { key: 'direction', label: 'Direction' },
    { key: 'createdAt', label: 'Created At' },
  ],
  item_assembly_line: [{ key: 'id', label: 'ID', locked: true }],
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
