import * as XLSX from 'xlsx';
import type { PurchaseOrder } from '../purchase-orders.schemas';
import { fetchPurchaseOrders } from '../purchase-orders.api';
import type { CustomFieldDefinition } from '../../../custom-fields/customFields.schemas';
import { formatCustomFieldValue } from '../../../custom-fields/formatCustomFieldValue';
import { formatDate } from '../../../../lib/formatDate';

export interface ExportPurchaseOrderColumnDef {
  key: string;
  header: string;
  width?: number;
  getValue: (po: PurchaseOrder, customFieldsDef?: CustomFieldDefinition[]) => string | number | null | undefined;
}

export const STANDARD_PURCHASE_ORDER_EXPORT_COLUMNS: ExportPurchaseOrderColumnDef[] = [
  {
    key: 'poNumber',
    header: 'PO Number',
    width: 22,
    getValue: (po) => po.poNumber,
  },
  {
    key: 'date',
    header: 'Date',
    width: 16,
    getValue: (po) => (po.date ? formatDate(po.date) : ''),
  },
  {
    key: 'vendor',
    header: 'Vendor',
    width: 25,
    getValue: (po) => po.vendor?.contactName || '',
  },
  {
    key: 'status',
    header: 'Status',
    width: 14,
    getValue: (po) => po.status ? po.status.charAt(0).toUpperCase() + po.status.slice(1) : '',
  },
  {
    key: 'total',
    header: 'Amount (INR)',
    width: 18,
    getValue: (po) => {
      const val = (po as Record<string, unknown>).total ?? po.totalAmount;
      return val !== null && val !== undefined ? Number(val) : '';
    },
  },
  {
    key: 'subTotal',
    header: 'Sub Total (INR)',
    width: 16,
    getValue: (po) => (po.subTotal !== null && po.subTotal !== undefined ? Number(po.subTotal) : ''),
  },
  {
    key: 'deliveryDate',
    header: 'Delivery Date',
    width: 16,
    getValue: (po) => (po.deliveryDate ? formatDate(po.deliveryDate) : ''),
  },
  {
    key: 'deliveryType',
    header: 'Delivery Type',
    width: 16,
    getValue: (po) => po.deliveryType || '',
  },
  {
    key: 'paymentTerms',
    header: 'Payment Terms',
    width: 18,
    getValue: (po) => po.paymentTerms || '',
  },
  {
    key: 'notes',
    header: 'Notes',
    width: 25,
    getValue: (po) => po.notes || '',
  },
  {
    key: 'termsAndConditions',
    header: 'Terms & Conditions',
    width: 25,
    getValue: (po) => po.termsAndConditions || '',
  },
  {
    key: 'createdAt',
    header: 'Created At',
    width: 18,
    getValue: (po) => (po.createdAt ? formatDate(po.createdAt) : ''),
  },
];

export function buildCustomFieldColumns(customFieldsDef?: CustomFieldDefinition[]): ExportPurchaseOrderColumnDef[] {
  if (!customFieldsDef || customFieldsDef.length === 0) return [];
  return customFieldsDef.map((def) => ({
    key: `cf_${def.key}`,
    header: def.label,
    width: Math.max(16, def.label.length + 4),
    getValue: (po) => {
      const val = po.customFields?.[def.key];
      return formatCustomFieldValue(val, def);
    },
  }));
}

export interface ExportPurchaseOrdersOptions {
  purchaseOrders: PurchaseOrder[];
  filename?: string;
  customFieldsDef?: CustomFieldDefinition[];
  visibleColumnKeys?: string[];
  exportAllFields?: boolean;
  format?: 'xlsx' | 'csv';
}

export function exportPurchaseOrdersToExcel({
  purchaseOrders,
  filename,
  customFieldsDef,
  visibleColumnKeys,
  exportAllFields = true,
  format = 'xlsx',
}: ExportPurchaseOrdersOptions): void {
  const customCols = buildCustomFieldColumns(customFieldsDef);
  const allColumns = [...STANDARD_PURCHASE_ORDER_EXPORT_COLUMNS, ...customCols];

  let selectedCols: ExportPurchaseOrderColumnDef[];
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
  const rows = purchaseOrders.map((item) =>
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
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Purchase Orders');

  const dateStr = new Date().toISOString().split('T')[0];
  const defaultBaseName = `Purchase_Orders_${dateStr}`;
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

export async function fetchAllPurchaseOrdersForExport(
  orgId: string,
  params: { search?: string; filter?: string } = {},
  onProgress?: (loaded: number) => void,
): Promise<PurchaseOrder[]> {
  const cleanParams: { search?: string; filter?: string } = {};
  if (params.search && params.search.trim()) cleanParams.search = params.search.trim();
  if (params.filter && params.filter !== 'all' && params.filter.trim()) cleanParams.filter = params.filter.trim();

  const allPurchaseOrders: PurchaseOrder[] = [];
  let currentPage = 1;
  const perPage = 500;
  let hasMore = true;

  while (hasMore) {
    const response = await fetchPurchaseOrders(orgId, {
      ...cleanParams,
      page: currentPage,
      perPage,
    });

    const pageResults = response?.results ?? [];
    allPurchaseOrders.push(...pageResults);

    if (onProgress) {
      onProgress(allPurchaseOrders.length);
    }

    if (response?.pageContext?.hasMore && pageResults.length > 0) {
      currentPage++;
    } else {
      hasMore = false;
    }
  }

  return allPurchaseOrders;
}
