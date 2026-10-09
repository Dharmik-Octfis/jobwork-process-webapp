import * as XLSX from 'xlsx';
import type { Bill } from '../bills.schemas';
import { fetchBills } from '../bills.api';
import { APPROVAL_LABELS } from '../billApproval';
import type { CustomFieldDefinition } from '../../../custom-fields/customFields.schemas';
import { formatCustomFieldValue } from '../../../custom-fields/formatCustomFieldValue';
import { formatDate } from '../../../../lib/formatDate';

export interface ExportBillColumnDef {
  key: string;
  header: string;
  width?: number;
  getValue: (bill: Bill, customFieldsDef?: CustomFieldDefinition[]) => string | number | null | undefined;
}

export const STANDARD_BILL_EXPORT_COLUMNS: ExportBillColumnDef[] = [
  {
    key: 'billNumber',
    header: 'Bill Number',
    width: 22,
    getValue: (bill) => bill.billNumber,
  },
  {
    key: 'billDate',
    header: 'Bill Date',
    width: 16,
    getValue: (bill) => (bill.billDate ? formatDate(bill.billDate) : ''),
  },
  {
    key: 'dueDate',
    header: 'Due Date',
    width: 16,
    getValue: (bill) => (bill.dueDate ? formatDate(bill.dueDate) : ''),
  },
  {
    key: 'vendor',
    header: 'Vendor',
    width: 25,
    getValue: (bill) => bill.vendor?.contactName || '',
  },
  {
    key: 'status',
    header: 'Status',
    width: 14,
    getValue: (bill) => bill.status ? bill.status.charAt(0).toUpperCase() + bill.status.slice(1) : '',
  },
  {
    key: 'approvalStatus',
    header: 'Approval Status',
    width: 16,
    getValue: (bill) => bill.approvalStatus ? (APPROVAL_LABELS[bill.approvalStatus] ?? bill.approvalStatus) : '',
  },
  {
    key: 'total',
    header: 'Total (INR)',
    width: 18,
    getValue: (bill) => {
      const val = (bill as Record<string, unknown>).total ?? bill.totalAmount;
      return val !== null && val !== undefined ? Number(val) : '';
    },
  },
  {
    key: 'subTotal',
    header: 'Sub Total (INR)',
    width: 16,
    getValue: (bill) => (bill.subTotal !== null && bill.subTotal !== undefined ? Number(bill.subTotal) : ''),
  },
  {
    key: 'paymentTerms',
    header: 'Payment Terms',
    width: 18,
    getValue: (bill) => bill.paymentTerms || '',
  },
  {
    key: 'termsAndConditions',
    header: 'Terms & Conditions',
    width: 25,
    getValue: (bill) => bill.termsAndConditions || '',
  },
  {
    key: 'createdAt',
    header: 'Created At',
    width: 18,
    getValue: (bill) => (bill.createdAt ? formatDate(bill.createdAt) : ''),
  },
];

export function buildCustomFieldColumns(customFieldsDef?: CustomFieldDefinition[]): ExportBillColumnDef[] {
  if (!customFieldsDef || customFieldsDef.length === 0) return [];
  return customFieldsDef.map((def) => ({
    key: `cf_${def.key}`,
    header: def.label,
    width: Math.max(16, def.label.length + 4),
    getValue: (bill) => {
      const val = bill.customFields?.[def.key];
      return formatCustomFieldValue(val, def);
    },
  }));
}

export interface ExportBillsOptions {
  bills: Bill[];
  filename?: string;
  customFieldsDef?: CustomFieldDefinition[];
  visibleColumnKeys?: string[];
  exportAllFields?: boolean;
  format?: 'xlsx' | 'csv';
}

export function exportBillsToExcel({
  bills,
  filename,
  customFieldsDef,
  visibleColumnKeys,
  exportAllFields = true,
  format = 'xlsx',
}: ExportBillsOptions): void {
  const customCols = buildCustomFieldColumns(customFieldsDef);
  const allColumns = [...STANDARD_BILL_EXPORT_COLUMNS, ...customCols];

  let selectedCols: ExportBillColumnDef[];
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
  const rows = bills.map((item) =>
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
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Bills');

  const dateStr = new Date().toISOString().split('T')[0];
  const defaultBaseName = `Bills_${dateStr}`;
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

export async function fetchAllBillsForExport(
  orgId: string,
  params: { search?: string; filter?: string } = {},
  onProgress?: (loaded: number) => void,
): Promise<Bill[]> {
  const cleanParams: { search?: string; filter?: string } = {};
  if (params.search && params.search.trim()) cleanParams.search = params.search.trim();
  if (params.filter && params.filter !== 'all' && params.filter.trim()) cleanParams.filter = params.filter.trim();

  const allBills: Bill[] = [];
  let currentPage = 1;
  const perPage = 500;
  let hasMore = true;

  while (hasMore) {
    const response = await fetchBills(orgId, {
      ...cleanParams,
      page: currentPage,
      perPage,
    });

    const pageResults = response?.results ?? [];
    allBills.push(...pageResults);

    if (onProgress) {
      onProgress(allBills.length);
    }

    if (response?.pageContext?.hasMore && pageResults.length > 0) {
      currentPage++;
    } else {
      hasMore = false;
    }
  }

  return allBills;
}
