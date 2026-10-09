import * as XLSX from 'xlsx';
import type { Vendor } from '../vendors.schemas';
import { fetchVendors } from '../vendors.api';
import type { CustomFieldDefinition } from '../../../custom-fields/customFields.schemas';
import { formatCustomFieldValue } from '../../../custom-fields/formatCustomFieldValue';
import { formatDate } from '../../../../lib/formatDate';

export interface ExportVendorColumnDef {
  key: string;
  header: string;
  width?: number;
  getValue: (v: Vendor, customFieldsDef?: CustomFieldDefinition[]) => string | number | null | undefined;
}

export const STANDARD_VENDOR_EXPORT_COLUMNS: ExportVendorColumnDef[] = [
  {
    key: 'contactNumber',
    header: 'Vendor Number',
    width: 20,
    getValue: (v) => v.contactNumber,
  },
  {
    key: 'contactName',
    header: 'Display Name',
    width: 25,
    getValue: (v) => v.contactName,
  },
  {
    key: 'companyName',
    header: 'Company Name',
    width: 25,
    getValue: (v) => v.companyName || '',
  },
  {
    key: 'email',
    header: 'Email',
    width: 25,
    getValue: (v) => v.email || '',
  },
  {
    key: 'phone',
    header: 'Phone',
    width: 16,
    getValue: (v) => v.phone || '',
  },
  {
    key: 'mobile',
    header: 'Mobile',
    width: 16,
    getValue: (v) => v.mobile || '',
  },
  {
    key: 'currency',
    header: 'Currency',
    width: 12,
    getValue: (v) => v.currency || 'INR',
  },
  {
    key: 'paymentTerms',
    header: 'Payment Terms',
    width: 18,
    getValue: (v) => v.paymentTerms || '',
  },
  {
    key: 'billingCity',
    header: 'Billing City',
    width: 18,
    getValue: (v) => v.billingCity || '',
  },
  {
    key: 'billingState',
    header: 'Billing State',
    width: 18,
    getValue: (v) => v.billingState || '',
  },
  {
    key: 'shippingCity',
    header: 'Shipping City',
    width: 18,
    getValue: (v) => v.shippingCity || '',
  },
  {
    key: 'shippingState',
    header: 'Shipping State',
    width: 18,
    getValue: (v) => v.shippingState || '',
  },
  {
    key: 'status',
    header: 'Status',
    width: 14,
    getValue: (v) => v.status ? v.status.charAt(0).toUpperCase() + v.status.slice(1) : 'Active',
  },
  {
    key: 'createdAt',
    header: 'Created At',
    width: 18,
    getValue: (v) => (v.createdAt ? formatDate(v.createdAt) : ''),
  },
];

export function buildCustomFieldColumns(customFieldsDef?: CustomFieldDefinition[]): ExportVendorColumnDef[] {
  if (!customFieldsDef || customFieldsDef.length === 0) return [];
  return customFieldsDef.map((def) => ({
    key: `cf_${def.key}`,
    header: def.label,
    width: Math.max(16, def.label.length + 4),
    getValue: (v) => {
      const val = v.customFields?.[def.key];
      return formatCustomFieldValue(val, def);
    },
  }));
}

export interface ExportVendorsOptions {
  vendors: Vendor[];
  filename?: string;
  customFieldsDef?: CustomFieldDefinition[];
  visibleColumnKeys?: string[];
  exportAllFields?: boolean;
  format?: 'xlsx' | 'csv';
}

export function exportVendorsToExcel({
  vendors,
  filename,
  customFieldsDef,
  visibleColumnKeys,
  exportAllFields = true,
  format = 'xlsx',
}: ExportVendorsOptions): void {
  const customCols = buildCustomFieldColumns(customFieldsDef);
  const allColumns = [...STANDARD_VENDOR_EXPORT_COLUMNS, ...customCols];

  let selectedCols: ExportVendorColumnDef[];
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
  const rows = vendors.map((item) =>
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
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Vendors');

  const dateStr = new Date().toISOString().split('T')[0];
  const defaultBaseName = `Vendors_${dateStr}`;
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

export async function fetchAllVendorsForExport(
  orgId: string,
  params: { search?: string; filter?: string } = {},
  onProgress?: (loaded: number) => void,
): Promise<Vendor[]> {
  const cleanParams: { search?: string; filter?: string } = {};
  if (params.search && params.search.trim()) cleanParams.search = params.search.trim();
  if (params.filter && params.filter !== 'all' && params.filter.trim()) cleanParams.filter = params.filter.trim();

  const allVendors: Vendor[] = [];
  let currentPage = 1;
  const perPage = 500;
  let hasMore = true;

  while (hasMore) {
    const response = await fetchVendors(orgId, {
      ...cleanParams,
      page: currentPage,
      perPage,
    });

    const pageResults = response?.results ?? [];
    allVendors.push(...pageResults);

    if (onProgress) {
      onProgress(allVendors.length);
    }

    if (response?.pageContext?.hasMore && pageResults.length > 0) {
      currentPage++;
    } else {
      hasMore = false;
    }
  }

  return allVendors;
}
