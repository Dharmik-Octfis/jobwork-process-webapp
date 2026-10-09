import * as XLSX from 'xlsx';
import type { Customer } from '../customers.schemas';
import { fetchCustomers } from '../customers.api';
import type { CustomFieldDefinition } from '../../../custom-fields/customFields.schemas';
import { formatCustomFieldValue } from '../../../custom-fields/formatCustomFieldValue';
import { formatDate } from '../../../../lib/formatDate';

export interface ExportCustomerColumnDef {
  key: string;
  header: string;
  width?: number;
  getValue: (c: Customer, customFieldsDef?: CustomFieldDefinition[]) => string | number | null | undefined;
}

export const STANDARD_CUSTOMER_EXPORT_COLUMNS: ExportCustomerColumnDef[] = [
  {
    key: 'contactNumber',
    header: 'Customer Number',
    width: 20,
    getValue: (c) => c.contactNumber,
  },
  {
    key: 'contactName',
    header: 'Display Name',
    width: 25,
    getValue: (c) => c.contactName,
  },
  {
    key: 'companyName',
    header: 'Company Name',
    width: 25,
    getValue: (c) => c.companyName || '',
  },
  {
    key: 'customerType',
    header: 'Type',
    width: 14,
    getValue: (c) => c.customerType ? c.customerType.charAt(0).toUpperCase() + c.customerType.slice(1) : '',
  },
  {
    key: 'email',
    header: 'Email',
    width: 25,
    getValue: (c) => c.email || '',
  },
  {
    key: 'phone',
    header: 'Phone',
    width: 16,
    getValue: (c) => c.phone || '',
  },
  {
    key: 'mobile',
    header: 'Mobile',
    width: 16,
    getValue: (c) => c.mobile || '',
  },
  {
    key: 'currency',
    header: 'Currency',
    width: 12,
    getValue: (c) => c.currency || 'INR',
  },
  {
    key: 'paymentTerms',
    header: 'Payment Terms',
    width: 18,
    getValue: (c) => c.paymentTerms || '',
  },
  {
    key: 'billingCity',
    header: 'Billing City',
    width: 18,
    getValue: (c) => c.billingCity || '',
  },
  {
    key: 'billingState',
    header: 'Billing State',
    width: 18,
    getValue: (c) => c.billingState || '',
  },
  {
    key: 'shippingCity',
    header: 'Shipping City',
    width: 18,
    getValue: (c) => c.shippingCity || '',
  },
  {
    key: 'shippingState',
    header: 'Shipping State',
    width: 18,
    getValue: (c) => c.shippingState || '',
  },
  {
    key: 'status',
    header: 'Status',
    width: 14,
    getValue: (c) => c.status ? c.status.charAt(0).toUpperCase() + c.status.slice(1) : 'Active',
  },
  {
    key: 'createdAt',
    header: 'Created At',
    width: 18,
    getValue: (c) => (c.createdAt ? formatDate(c.createdAt) : ''),
  },
];

export function buildCustomFieldColumns(customFieldsDef?: CustomFieldDefinition[]): ExportCustomerColumnDef[] {
  if (!customFieldsDef || customFieldsDef.length === 0) return [];
  return customFieldsDef.map((def) => ({
    key: `cf_${def.key}`,
    header: def.label,
    width: Math.max(16, def.label.length + 4),
    getValue: (c) => {
      const val = c.customFields?.[def.key];
      return formatCustomFieldValue(val, def);
    },
  }));
}

export interface ExportCustomersOptions {
  customers: Customer[];
  filename?: string;
  customFieldsDef?: CustomFieldDefinition[];
  visibleColumnKeys?: string[];
  exportAllFields?: boolean;
  format?: 'xlsx' | 'csv';
}

export function exportCustomersToExcel({
  customers,
  filename,
  customFieldsDef,
  visibleColumnKeys,
  exportAllFields = true,
  format = 'xlsx',
}: ExportCustomersOptions): void {
  const customCols = buildCustomFieldColumns(customFieldsDef);
  const allColumns = [...STANDARD_CUSTOMER_EXPORT_COLUMNS, ...customCols];

  let selectedCols: ExportCustomerColumnDef[];
  if (exportAllFields || !visibleColumnKeys || visibleColumnKeys.length === 0) {
    selectedCols = allColumns;
  } else {
    selectedCols = allColumns.filter((col) => {
      if (visibleColumnKeys.includes(col.key)) return true;
      if (col.key.startsWith('cf_')) {
        const cfKey = col.key.slice(3);
        return visibleColumnKeys.includes(`cf:${cfKey}`) || visibleColumnKeys.includes(`cf_${cfKey}`);
      }
      return false;
    });

    if (selectedCols.length === 0) {
      selectedCols = allColumns;
    }
  }

  const headers = selectedCols.map((c) => c.header);
  const rows = customers.map((item) =>
    selectedCols.map((col) => {
      const val = col.getValue(item, customFieldsDef);
      return val === null || val === undefined ? '' : val;
    }),
  );

  const worksheetData = [headers, ...rows];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  const colWidths = selectedCols.map((col, idx) => {
    let maxLen = col.header.length;
    for (const row of rows) {
      const cellVal = row[idx];
      if (cellVal !== undefined && cellVal !== null) {
        const strLen = String(cellVal).length;
        if (strLen > maxLen) maxLen = strLen;
      }
    }
    return { wch: Math.min(Math.max(maxLen + 3, col.width || 12), 60) };
  });
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Customers');

  const dateStr = new Date().toISOString().split('T')[0];
  const defaultBaseName = `Customers_${dateStr}`;
  const finalFilename = filename
    ? filename.endsWith(`.${format}`)
      ? filename
      : `${filename}.${format}`
    : `${defaultBaseName}.${format}`;

  if (format === 'csv') {
    XLSX.writeFile(workbook, finalFilename, { bookType: 'csv' });
  } else {
    XLSX.writeFile(workbook, finalFilename, { bookType: 'xlsx' });
  }
}

export async function fetchAllCustomersForExport(
  orgId: string,
  params: { search?: string; filter?: string } = {},
  onProgress?: (loaded: number) => void,
): Promise<Customer[]> {
  const cleanParams: { search?: string; filter?: string } = {};
  if (params.search && params.search.trim()) cleanParams.search = params.search.trim();
  if (params.filter && params.filter !== 'all' && params.filter.trim()) cleanParams.filter = params.filter.trim();

  const allCustomers: Customer[] = [];
  let currentPage = 1;
  const perPage = 500;
  let hasMore = true;

  while (hasMore) {
    const response = await fetchCustomers(orgId, {
      ...cleanParams,
      page: currentPage,
      perPage,
    });

    const pageResults = response?.results ?? [];
    allCustomers.push(...pageResults);

    if (onProgress) {
      onProgress(allCustomers.length);
    }

    if (response?.pageContext?.hasMore && pageResults.length > 0) {
      currentPage++;
    } else {
      hasMore = false;
    }
  }

  return allCustomers;
}
