import * as XLSX from 'xlsx';
import type { SalesOrder } from '../sales-orders.schemas';
import { fetchSalesOrders } from '../sales-orders.api';
import type { CustomFieldDefinition } from '../../../custom-fields/customFields.schemas';
import { formatCustomFieldValue } from '../../../custom-fields/formatCustomFieldValue';
import { formatDate } from '../../../../lib/formatDate';

export interface ExportSalesOrderColumnDef {
  key: string;
  header: string;
  width?: number;
  getValue: (so: SalesOrder, customFieldsDef?: CustomFieldDefinition[]) => string | number | null | undefined;
}

export const STANDARD_SALES_ORDER_EXPORT_COLUMNS: ExportSalesOrderColumnDef[] = [
  {
    key: 'soNumber',
    header: 'Sales Order Number',
    width: 22,
    getValue: (so) => so.soNumber || '',
  },
  {
    key: 'date',
    header: 'Order Date',
    width: 16,
    getValue: (so) => (so.date ? formatDate(so.date) : ''),
  },
  {
    key: 'customer',
    header: 'Customer',
    width: 25,
    getValue: (so) => {
      if (typeof so.customer === 'string') return so.customer;
      return so.customer?.contactName || so.customer?.companyName || so.customer?.displayName || '';
    },
  },
  {
    key: 'status',
    header: 'Status',
    width: 14,
    getValue: (so) => {
      if (!so.status) return '';
      const s = String(so.status);
      return s.charAt(0).toUpperCase() + s.slice(1);
    },
  },
  {
    key: 'totalAmount',
    header: 'Total Amount (INR)',
    width: 18,
    getValue: (so) => {
      const val = (so as Record<string, unknown>).total ?? so.totalAmount;
      return val !== null && val !== undefined && val !== '' ? Number(val) : '';
    },
  },
  {
    key: 'subTotal',
    header: 'Sub Total (INR)',
    width: 16,
    getValue: (so) => (so.subTotal !== null && so.subTotal !== undefined && so.subTotal !== '' ? Number(so.subTotal) : ''),
  },
  {
    key: 'deliveryDate',
    header: 'Delivery Date',
    width: 16,
    getValue: (so) => (so.deliveryDate ? formatDate(so.deliveryDate) : ''),
  },
  {
    key: 'deliveryType',
    header: 'Delivery Type',
    width: 16,
    getValue: (so) => so.deliveryType || '',
  },
  {
    key: 'paymentTerms',
    header: 'Payment Terms',
    width: 18,
    getValue: (so) => so.paymentTerms || '',
  },
  {
    key: 'notes',
    header: 'Notes',
    width: 25,
    getValue: (so) => so.notes || '',
  },
  {
    key: 'termsAndConditions',
    header: 'Terms & Conditions',
    width: 25,
    getValue: (so) => so.termsAndConditions || '',
  },
  {
    key: 'createdAt',
    header: 'Created At',
    width: 18,
    getValue: (so) => {
      const created = (so as Record<string, unknown>).createdAt;
      return created ? formatDate(created as string | Date) : '';
    },
  },
];

export function buildCustomFieldColumns(customFieldsDef?: CustomFieldDefinition[]): ExportSalesOrderColumnDef[] {
  if (!customFieldsDef || customFieldsDef.length === 0) return [];
  return customFieldsDef.map((def) => ({
    key: `cf_${def.key}`,
    header: def.label,
    width: Math.max(16, def.label.length + 4),
    getValue: (so) => {
      const val = so.customFields?.[def.key];
      return formatCustomFieldValue(val, def);
    },
  }));
}

export interface ExportSalesOrdersOptions {
  salesOrders: SalesOrder[];
  filename?: string;
  customFieldsDef?: CustomFieldDefinition[];
  visibleColumnKeys?: string[];
  exportAllFields?: boolean;
  format?: 'xlsx' | 'csv';
}

export function exportSalesOrdersToExcel({
  salesOrders,
  filename,
  customFieldsDef,
  visibleColumnKeys,
  exportAllFields = true,
  format = 'xlsx',
}: ExportSalesOrdersOptions): void {
  const customCols = buildCustomFieldColumns(customFieldsDef);
  const allColumns = [...STANDARD_SALES_ORDER_EXPORT_COLUMNS, ...customCols];

  let selectedCols: ExportSalesOrderColumnDef[];
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
  const rows = salesOrders.map((item) =>
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
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sales Orders');

  const dateStr = new Date().toISOString().split('T')[0];
  const defaultBaseName = `Sales_Orders_${dateStr}`;
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

export async function fetchAllSalesOrdersForExport(
  orgId: string,
  params: { search?: string; filter?: string } = {},
  onProgress?: (loaded: number) => void,
): Promise<SalesOrder[]> {
  const cleanParams: { search?: string; filter?: string } = {};
  if (params.search && params.search.trim()) cleanParams.search = params.search.trim();
  if (params.filter && params.filter !== 'all' && params.filter.trim()) cleanParams.filter = params.filter.trim();

  const allSalesOrders: SalesOrder[] = [];
  let currentPage = 1;
  const perPage = 500;
  let hasMore = true;

  while (hasMore) {
    const response = await fetchSalesOrders(orgId, {
      ...cleanParams,
      page: currentPage,
      perPage,
    });

    const pageResults = response?.results ?? [];
    allSalesOrders.push(...pageResults);

    if (onProgress) {
      onProgress(allSalesOrders.length);
    }

    if (response?.pageContext?.hasMore && pageResults.length > 0) {
      currentPage++;
    } else {
      hasMore = false;
    }
  }

  return allSalesOrders;
}
