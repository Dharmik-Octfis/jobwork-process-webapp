/**
 * Dynamic resolver for mapping CRM module entities to their record detail / view URLs.
 */
export function resolveRecordRoute(orgId: string, moduleId: string, recordId: string): string {
  const norm = moduleId.trim().toLowerCase();

  switch (norm) {
    case 'items':
    case 'item':
      return `/organizations/${orgId}/items?id=${recordId}`;
    case 'purchase_orders':
    case 'purchase_order':
    case 'po':
      return `/organizations/${orgId}/purchases/purchase-orders?id=${recordId}`;
    case 'bills':
    case 'bill':
      return `/organizations/${orgId}/purchases/bills?id=${recordId}`;
    case 'vendors':
    case 'vendor':
      return `/organizations/${orgId}/purchases/vendors?id=${recordId}`;
    case 'customers':
    case 'customer':
      return `/organizations/${orgId}/sales/customers?id=${recordId}`;
    case 'job_orders':
    case 'job_order':
      return `/organizations/${orgId}/jobwork/job-orders/${recordId}`;
    case 'job_issues':
    case 'issues':
    case 'job_issue':
      return `/organizations/${orgId}/jobwork/issues?id=${recordId}`;
    case 'job_receipts':
    case 'receipts':
    case 'job_receipt':
      return `/organizations/${orgId}/jobwork/receipts?id=${recordId}`;
    case 'composite_items':
    case 'composite_item':
      return `/organizations/${orgId}/composite-items?id=${recordId}`;
    case 'assembly':
    case 'item_assembly':
      return `/organizations/${orgId}/inventory/assembly?id=${recordId}`;
    default:
      return `/organizations/${orgId}/${norm}?id=${recordId}`;
  }
}

/**
 * Returns user-friendly module badge display text and color palette.
 */
export function getModuleBadgeStyle(moduleId: string): { label: string; color: string; bg: string } {
  const norm = moduleId.trim().toLowerCase();
  switch (norm) {
    case 'items':
    case 'item':
      return { label: 'Items', color: '#0284c7', bg: '#e0f2fe' };
    case 'purchase_orders':
    case 'purchase_order':
    case 'po':
      return { label: 'Purchase Orders', color: '#7c3aed', bg: '#ede9fe' };
    case 'bills':
    case 'bill':
      return { label: 'Bills', color: '#ea580c', bg: '#ffedd5' };
    case 'vendors':
    case 'vendor':
      return { label: 'Vendors', color: '#0d9488', bg: '#ccfbf1' };
    case 'customers':
    case 'customer':
      return { label: 'Customers', color: '#2563eb', bg: '#dbeafe' };
    case 'job_orders':
    case 'job_order':
      return { label: 'Job Orders', color: '#059669', bg: '#d1fae5' };
    default:
      return {
        label: moduleId.replace(/_/g, ' ').toUpperCase(),
        color: '#475569',
        bg: '#f1f5f9',
      };
  }
}
