import { prisma, runAsTenant } from '../../../db/prisma.ts';
import {
  LIST_COLUMNS,
  isListEntityType,
  type ListEntityType,
} from '../../settings/list-views/listViews.catalog.ts';
import type { FieldMetadata, ModuleMetadata } from './approvalProcess.types.ts';
import type { FieldDataType } from './approvalProcess.constants.ts';

/**
 * Maps an app_modules code or entity name to a ListEntityType understood by the schema catalogs.
 */
function toEntityType(codeOrId: string): string {
  const normalized = codeOrId.trim().toUpperCase();
  switch (normalized) {
    case 'PO':
    case 'PURCHASE_ORDER':
    case 'PURCHASE_ORDERS':
      return 'purchase_order';
    case 'BILLS':
    case 'BILL':
      return 'bill';
    case 'VENDORS':
    case 'VENDOR':
      return 'vendor';
    case 'CUSTOMERS':
    case 'CUSTOMER':
      return 'customer';
    case 'ITEMS':
    case 'ITEM':
      return 'item';
    case 'COMPOSITE_ITEMS':
    case 'COMPOSITE_ITEM':
      return 'composite_item_component';
    case 'ASSEMBLY':
    case 'ITEM_ASSEMBLY':
      return 'item_assembly';
    case 'JOB_ORDERS':
    case 'JOB_ORDER':
      return 'job_order';
    case 'ISSUES':
    case 'JOB_ISSUE':
      return 'job_issue';
    case 'RECEIPTS':
    case 'JOB_RECEIPT':
      return 'job_receipt';
    case 'MEMBERS':
    case 'MEMBER':
    case 'USERS':
    case 'USER':
      return 'member';
    default:
      return codeOrId.trim().toLowerCase();
  }
}

/**
 * Infers FieldDataType for standard columns.
 */
function inferDataType(key: string): FieldDataType {
  const lower = key.toLowerCase();
  if (lower === 'status') return 'status';
  if (lower.endsWith('date') || lower.endsWith('at') || lower === 'date') return 'date';
  if (
    lower === 'total' ||
    lower.includes('amount') ||
    lower.includes('rate') ||
    lower.includes('price') ||
    lower.includes('value') ||
    lower.includes('revenue') ||
    lower.includes('subtotal')
  ) {
    return 'currency';
  }
  if (
    lower.includes('qty') ||
    lower.includes('count') ||
    lower.includes('stepcount') ||
    (lower.includes('number') &&
      !lower.includes('ponumber') &&
      !lower.includes('billnumber') &&
      !lower.includes('contactnumber') &&
      !lower.includes('challannumber') &&
      !lower.includes('receiptnumber') &&
      !lower.includes('jobordernumber'))
  ) {
    return 'number';
  }
  if (lower.startsWith('is') || lower.startsWith('has')) return 'boolean';
  if (lower.includes('email')) return 'email';
  if (lower.includes('phone') || lower.includes('mobile')) return 'phone';
  if (lower.includes('notes') || lower.includes('remarks') || lower.includes('description')) {
    return 'textarea';
  }
  return 'text';
}

/**
 * Standard options for enum and select fields.
 */
function getFieldOptions(entityType: string, fieldKey: string): Array<{ id: string; label: string }> | undefined {
  if (fieldKey.toLowerCase() !== 'status') {
    if (fieldKey === 'type' && entityType === 'item') {
      return [
        { id: 'goods', label: 'Goods' },
        { id: 'service', label: 'Service' },
      ];
    }
    return undefined;
  }

  switch (entityType) {
    case 'purchase_order':
      return [
        { id: 'Draft', label: 'Draft' },
        { id: 'Pending Approval', label: 'Pending Approval' },
        { id: 'Approved', label: 'Approved' },
        { id: 'Issued', label: 'Issued' },
        { id: 'Cancelled', label: 'Cancelled' },
      ];
    case 'bill':
      return [
        { id: 'Draft', label: 'Draft' },
        { id: 'Pending Approval', label: 'Pending Approval' },
        { id: 'Approved', label: 'Approved' },
        { id: 'Paid', label: 'Paid' },
        { id: 'Cancelled', label: 'Cancelled' },
      ];
    case 'job_order':
      return [
        { id: 'Draft', label: 'Draft' },
        { id: 'Pending Approval', label: 'Pending Approval' },
        { id: 'Approved', label: 'Approved' },
        { id: 'In Progress', label: 'In Progress' },
        { id: 'Completed', label: 'Completed' },
      ];
    case 'vendor':
    case 'customer':
      return [
        { id: 'active', label: 'Active' },
        { id: 'inactive', label: 'Inactive' },
      ];
    default:
      return [
        { id: 'Draft', label: 'Draft' },
        { id: 'Pending Approval', label: 'Pending Approval' },
        { id: 'Approved', label: 'Approved' },
        { id: 'Rejected', label: 'Rejected' },
      ];
  }
}

const KNOWN_MODULE_TABLE_MAP: Record<string, string> = {
  // Purchases
  PO: 'purchase_orders',
  PURCHASE_ORDER: 'purchase_orders',
  PURCHASE_ORDERS: 'purchase_orders',
  BILLS: 'bills',
  BILL: 'bills',
  VENDORS: 'vendors',
  VENDOR: 'vendors',

  // Sales
  CUSTOMERS: 'customers',
  CUSTOMER: 'customers',
  SALES_ORDERS: 'sales_orders',
  SALES_ORDER: 'sales_orders',
  INVOICES: 'invoices',
  INVOICE: 'invoices',
  QUOTATIONS: 'quotations',
  QUOTATION: 'quotations',

  // Items & Inventory
  ITEMS: 'items',
  ITEM: 'items',
  COMPOSITE_ITEMS: 'items',
  COMPOSITE_ITEM: 'items',
  ASSEMBLY: 'item_assemblies',
  ITEM_ASSEMBLY: 'item_assemblies',
  ASSEMBLIES: 'item_assemblies',

  // Jobwork
  JOB_ORDERS: 'job_orders',
  JOB_ORDER: 'job_orders',
  ISSUES: 'job_issues',
  JOB_ISSUE: 'job_issues',
  JOB_ISSUES: 'job_issues',
  RECEIPTS: 'job_receipts',
  JOB_RECEIPT: 'job_receipts',
  JOB_RECEIPTS: 'job_receipts',
  PROCESSES: 'processes',
  PROCESS: 'processes',
  ROUTES: 'routes',
  ROUTE: 'routes',

  // System & Users
  USERS: 'users',
  USER: 'users',
  MEMBERS: 'users',
  MEMBER: 'users',
  ROLES: 'roles',
  ROLE: 'roles',
};

/**
 * Dynamically resolves the PostgreSQL table name for any module.
 * Falls back to querying information_schema.tables to verify candidate table names.
 */
async function resolveTableName(
  codeOrId: string,
  appModule?: { code: string; name: string } | null,
): Promise<string | null> {
  const code = (appModule?.code || codeOrId).trim().toUpperCase();
  if (KNOWN_MODULE_TABLE_MAP[code]) {
    return KNOWN_MODULE_TABLE_MAP[code];
  }

  // Generate candidate table names from module code and display name
  const candidates = new Set<string>();
  const rawCode = (appModule?.code || codeOrId).trim().toLowerCase();
  candidates.add(rawCode);
  candidates.add(`${rawCode}s`);
  candidates.add(rawCode.replace(/-/g, '_'));
  candidates.add(`${rawCode.replace(/-/g, '_')}s`);

  if (appModule?.name) {
    const fromName = appModule.name.trim().toLowerCase().replace(/\s+/g, '_');
    candidates.add(fromName);
    candidates.add(`${fromName}s`);
  }

  // Verify candidate tables against PostgreSQL's live catalog
  const candidateList = Array.from(candidates);
  try {
    const matchingTables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name 
       FROM information_schema.tables 
       WHERE table_schema = 'public' 
         AND table_type = 'BASE TABLE'
         AND table_name = ANY($1::text[])
       LIMIT 1`,
      candidateList,
    );

    const match = matchingTables[0];
    if (match) {
      return match.table_name;
    }
  } catch (err) {
    console.error('Error resolving table name from PostgreSQL catalog:', err);
  }

  return null;
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
}

/**
 * Maps known FK column names (snake_case) → the entity type they reference.
 * Any column whose name ends in `_id` that is not in this map is treated as a
 * plain UUID text field — we don't want to show a dropdown for arbitrary UUIDs
 * that have no list endpoint.
 */
const FK_COLUMN_TO_MODULE: Record<string, string> = {
  // Identity / audit
  created_by: 'member',
  updated_by: 'member',
  // Purchases
  vendor_id: 'vendor',
  purchase_order_id: 'purchase_order',
  bill_id: 'bill',
  // Sales
  customer_id: 'customer',
  // Items & Inventory
  item_id: 'item',
  // Jobwork
  job_order_id: 'job_order',
  job_issue_id: 'job_issue',
  job_receipt_id: 'job_receipt',
  // Locations
  location_id: 'location',
  delivery_location_id: 'location',
  delivery_customer_id: 'customer',
  // Step / process
  step_id: 'process',
  process_id: 'process',
};

/** Returns the related entity type for a FK column, or null for non-FK columns. */
function inferRelatedModule(columnName: string): string | null {
  return FK_COLUMN_TO_MODULE[columnName.toLowerCase()] ?? null;
}

function formatColumnLabel(columnName: string): string {
  const SPECIAL_LABELS: Record<string, string> = {
    po_number: 'PO Number',
    po_date: 'PO Date',
    delivery_date: 'Delivery Date',
    delivery_type: 'Delivery Type',
    delivery_location_id: 'Delivery Location',
    delivery_customer_id: 'Delivery Customer',
    sub_total: 'Sub Total',
    total_amount: 'Total Amount',
    payment_terms: 'Payment Terms',
    terms_and_conditions: 'Terms & Conditions',
    location_id: 'Location',
    vendor_id: 'Vendor',
    customer_id: 'Customer',
    item_id: 'Item',
    bill_number: 'Bill Number',
    bill_date: 'Bill Date',
    due_date: 'Due Date',
    created_at: 'Created At',
    updated_at: 'Last Modified',
    created_by: 'Created By',
    updated_by: 'Updated By',
    notes: 'Notes',
    status: 'Status',
    sku: 'SKU',
    attachments: 'Attachments',
    contact_name: 'Contact Name',
    company_name: 'Company Name',
    contact_number: 'Contact Number',
    job_order_id: 'Job Order',
    job_order_number: 'Job Order Number',
    job_issue_id: 'Job Challan',
    job_receipt_id: 'Job Receipt',
    ownership: 'Ownership',
    target_date: 'Target Date',
    order_date: 'Order Date',
    issue_number: 'Challan Number',
    issue_date: 'Challan Date',
    receipt_number: 'Receipt Number',
    receipt_date: 'Receipt Date',
    item_name: 'Item Name',
    item_type: 'Item Type',
    unit_of_measurement: 'Unit of Measurement',
    unit_price: 'Unit Price',
    selling_price: 'Selling Price',
    purchase_price: 'Purchase Price',
    assembly_number: 'Assembly Number',
    assembly_date: 'Assembly Date',
  };

  if (SPECIAL_LABELS[columnName]) {
    return SPECIAL_LABELS[columnName];
  }

  // For unmapped FK columns: strip trailing _id suffix for a cleaner label
  const col = columnName.toLowerCase();
  if (col.endsWith('_id') && inferRelatedModule(col)) {
    return columnName
      .slice(0, -3) // remove trailing _id
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  return columnName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function mapPgTypeToFieldType(dataType: string, udtName: string, columnName: string): FieldDataType {
  const col = columnName.toLowerCase();
  if (col === 'status') return 'status';
  // FK columns that have a known related module → render as lookup
  if (inferRelatedModule(col)) return 'lookup';
  if (col.includes('email')) return 'email';
  if (col.includes('phone') || col.includes('mobile')) return 'phone';
  if (dataType.includes('timestamp') || dataType.includes('date')) return 'date';
  if (
    dataType === 'numeric' ||
    dataType === 'decimal' ||
    dataType === 'real' ||
    dataType === 'double precision' ||
    col.includes('price') ||
    col.includes('amount') ||
    col.includes('rate') ||
    col.includes('sub_total')
  ) {
    if (col.includes('qty') || col.includes('count')) return 'number';
    return 'currency';
  }
  if (dataType.includes('int')) return 'number';
  if (dataType === 'boolean') return 'boolean';
  if (dataType === 'text' || udtName === 'text') {
    if (
      col.includes('notes') ||
      col.includes('terms') ||
      col.includes('description') ||
      col.includes('remarks') ||
      col.includes('address')
    ) {
      return 'textarea';
    }
  }
  if (col === 'delivery_type') return 'select';
  return 'text';
}

export class ModuleMetadataService {
  /**
   * Returns all approval-supported modules for an organization directly from the database (app_modules).
   */
  async getModules(_organizationId: string): Promise<ModuleMetadata[]> {
    const appModules = await prisma.appModule.findMany({
      where: { isActive: true },
      include: { parent: true },
      orderBy: { sortIndex: 'asc' },
    });

    const parentIds = new Set(appModules.map((m) => m.parentId).filter(Boolean) as string[]);

    // Filter to document & master record modules (exclude dashboard, reports, and top-level categories)
    const operationalModules = appModules.filter(
      (m) => !parentIds.has(m.id) && m.code !== 'DASHBOARD' && m.code !== 'REPORTS',
    );

    return operationalModules.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      category: m.parent?.name || 'General',
      supportsApprovals: true,
      icon: m.icon || m.parent?.icon || 'FileText',
    }));
  }

  /**
   * Retrieves single module metadata by ID, code, or entity name.
   */
  async getModuleById(organizationId: string, moduleId: string): Promise<ModuleMetadata | null> {
    const modules = await this.getModules(organizationId);
    const search = moduleId.trim().toLowerCase();
    return (
      modules.find(
        (m) =>
          m.id.toLowerCase() === search ||
          m.code.toLowerCase() === search ||
          toEntityType(m.code) === search ||
          m.name.toLowerCase() === search,
      ) || null
    );
  }

  /**
   * Dynamically loads all fields for ANY module by combining:
   * 1. Real database columns queried dynamically from PostgreSQL (information_schema.columns)
   * 2. Per-tenant custom fields from custom_field_definitions
   *
   * CRITICAL RULE: Primary keys are NEVER returned in the field list.
   */
  async getModuleFields(organizationId: string, moduleId: string): Promise<FieldMetadata[]> {
    const appModules = await prisma.appModule.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
    });

    // Resolve which entity type and database table this module maps to
    const search = moduleId.trim().toLowerCase();
    let entityType = toEntityType(moduleId);

    const matchingAppModule = appModules.find(
      (m) =>
        m.id.toLowerCase() === search ||
        m.code.toLowerCase() === search ||
        m.name.toLowerCase() === search ||
        toEntityType(m.code) === search,
    );
    if (matchingAppModule) {
      entityType = toEntityType(matchingAppModule.code);
    }

    const fields: FieldMetadata[] = [];
    const tableName = await resolveTableName(matchingAppModule?.code || moduleId, matchingAppModule);

    // 1. Dynamically introspect all database columns from PostgreSQL system catalog
    if (tableName) {
      try {
        const dbColumns = await prisma.$queryRawUnsafe<
          Array<{
            column_name: string;
            data_type: string;
            udt_name: string;
            is_nullable: string;
            is_primary_key: boolean;
          }>
        >(
          `SELECT 
             c.column_name, 
             c.data_type, 
             c.udt_name,
             c.is_nullable,
             CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key
           FROM information_schema.columns c
           LEFT JOIN (
             SELECT kcu.column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
             WHERE tc.constraint_type = 'PRIMARY KEY'
               AND tc.table_schema = 'public'
               AND tc.table_name = $1
           ) pk ON c.column_name = pk.column_name
           WHERE c.table_schema = 'public' 
             AND c.table_name = $1 
           ORDER BY c.ordinal_position ASC`,
          tableName,
        );

        // System infrastructure columns to exclude from rule evaluation
        const IGNORED_COLUMNS = new Set([
          'organization_id',
          'is_deleted',
          'custom_fields',
          'password_hash',
          'refresh_token',
          'token',
        ]);

        for (const col of dbColumns) {
          // CRITICAL: NEVER send primary key in get field response
          if (col.is_primary_key || col.column_name.toLowerCase() === 'id') {
            continue;
          }

          // Filter out internal system/tenant isolation columns
          if (IGNORED_COLUMNS.has(col.column_name.toLowerCase())) {
            continue;
          }

          const camelKey = toCamelCase(col.column_name);
          const label = formatColumnLabel(col.column_name);
          const dataType = mapPgTypeToFieldType(col.data_type, col.udt_name, col.column_name);

          const relatedMod = inferRelatedModule(col.column_name);
          fields.push({
            id: camelKey,
            moduleId,
            apiName: camelKey,
            label,
            dataType,
            required: col.is_nullable === 'NO' && !['created_at', 'updated_at'].includes(col.column_name),
            isActive: true,
            isCustom: false,
            options: getFieldOptions(entityType, camelKey),
            relatedModule: relatedMod ?? undefined,
          });
        }
      } catch (err) {
        console.error('Failed to introspect columns for table', tableName, err);
      }
    }

    // Fallback: If table introspection yielded no fields, load from LIST_COLUMNS
    if (fields.length === 0 && isListEntityType(entityType) && LIST_COLUMNS[entityType as ListEntityType]) {
      for (const col of LIST_COLUMNS[entityType as ListEntityType]) {
        // NEVER send primary key in fallback either
        if (col.key.toLowerCase() === 'id') continue;

        fields.push({
          id: col.key,
          moduleId,
          apiName: col.key,
          label: col.label,
          dataType: inferDataType(col.key),
          required: Boolean(col.locked),
          isActive: true,
          isCustom: false,
          options: getFieldOptions(entityType, col.key),
        });
      }
    }

    // 2. If still no columns found, provide standard baseline fields (NEVER including primary key)
    if (fields.length === 0) {
      fields.push(
        {
          id: 'name',
          moduleId,
          apiName: 'name',
          label: 'Name / Title',
          dataType: 'text',
          required: true,
          isActive: true,
          isCustom: false,
        },
        {
          id: 'status',
          moduleId,
          apiName: 'status',
          label: 'Status',
          dataType: 'status',
          required: true,
          isActive: true,
          isCustom: false,
          options: [
            { id: 'Draft', label: 'Draft' },
            { id: 'Pending Approval', label: 'Pending Approval' },
            { id: 'Approved', label: 'Approved' },
            { id: 'Rejected', label: 'Rejected' },
          ],
        },
        {
          id: 'createdAt',
          moduleId,
          apiName: 'createdAt',
          label: 'Created At',
          dataType: 'date',
          required: true,
          isActive: true,
          isCustom: false,
        },
        {
          id: 'updatedAt',
          moduleId,
          apiName: 'updatedAt',
          label: 'Last Modified',
          dataType: 'date',
          required: false,
          isActive: true,
          isCustom: false,
        },
      );
    }

    // 3. Discover dynamic tenant custom fields from custom_field_definitions.
    // MUST run inside runAsTenant so the RLS policy (which checks
    // `app.current_tenant`) allows the query through; without it the policy
    // returns 0 rows and the catch block silently swallows the error.
    try {
      const customDefs = await runAsTenant(organizationId, (tx) =>
        tx.customFieldDefinition.findMany({
          where: {
            organizationId,
            entityType,
            isDeleted: false,
            status: 'active',
          },
          orderBy: { displayOrder: 'asc' },
        }),
      );

      for (const def of customDefs) {
        const config = (def.config || {}) as { options?: Array<{ id: string; label: string }> };
        fields.push({
          id: `customFields.${def.key}`,
          moduleId,
          apiName: `customFields.${def.key}`,
          label: def.label,
          dataType: (def.dataType as FieldDataType) || 'text',
          required: def.isRequired,
          isActive: true,
          isCustom: true,
          options: config.options || [],
        });
      }
    } catch (err) {
      console.error(
        `[ModuleMetadataService] Failed to load custom fields for ${entityType} (org=${organizationId}):`,
        err,
      );
      // Return fields found so far — a custom-field failure should not block the approval engine
    }

    return fields;
  }
}

export const moduleMetadataService = new ModuleMetadataService();
