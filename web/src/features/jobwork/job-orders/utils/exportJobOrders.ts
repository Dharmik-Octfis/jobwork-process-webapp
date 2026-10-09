import * as XLSX from 'xlsx';
import type { JobOrder } from '../jobOrders.schemas';
import { fetchJobOrders } from '../jobOrders.api';
import { JOB_ORDER_STATUS_META } from '../../jobwork.schemas';
import type { CustomFieldDefinition } from '../../../custom-fields/customFields.schemas';
import { formatCustomFieldValue } from '../../../custom-fields/formatCustomFieldValue';
import { formatDate } from '../../../../lib/formatDate';

export interface ExportJobOrderColumnDef {
  key: string;
  header: string;
  width?: number;
  getValue: (
    order: JobOrder,
    stepIndex?: number,
    customFieldsDef?: CustomFieldDefinition[],
  ) => string | number | null | undefined;
}

export const STANDARD_JOB_ORDER_EXPORT_COLUMNS: ExportJobOrderColumnDef[] = [
  {
    key: 'jobOrderNumber',
    header: 'Job Order#',
    width: 20,
    getValue: (order) => order.jobOrderNumber,
  },
  {
    key: 'orderDate',
    header: 'Date',
    width: 16,
    getValue: (order) => (order.orderDate ? formatDate(order.orderDate) : ''),
  },
  {
    key: 'targetDate',
    header: 'Target Date',
    width: 16,
    getValue: (order) => (order.targetDate ? formatDate(order.targetDate) : ''),
  },
  {
    key: 'route',
    header: 'Route',
    width: 22,
    getValue: (order) => order.routeNameSnapshot || order.route?.name || '',
  },
  {
    key: 'materialBelongsTo',
    header: 'Material Belongs To',
    width: 22,
    getValue: (order) => (order.ownership === 'customer' ? 'Customer’s' : 'Ours'),
  },
  {
    key: 'status',
    header: 'Status',
    width: 16,
    getValue: (order) =>
      JOB_ORDER_STATUS_META[order.status as keyof typeof JOB_ORDER_STATUS_META]?.label ||
      (order.status ? order.status.charAt(0).toUpperCase() + order.status.slice(1) : ''),
  },
  {
    key: 'process',
    header: 'Process',
    width: 20,
    getValue: (order, stepIndex = 0) => {
      const step = order.steps?.[stepIndex];
      return step ? step.processNameSnapshot || step.process?.name || '' : '';
    },
  },
  {
    key: 'doneBy',
    header: 'Done By',
    width: 16,
    getValue: (order, stepIndex = 0) => {
      const step = order.steps?.[stepIndex];
      if (!step) return '';
      return step.processorType === 'vendor' ? 'Vendor' : 'In-house';
    },
  },
  {
    key: 'processorName',
    header: 'Processor',
    width: 24,
    getValue: (order, stepIndex = 0) => {
      const step = order.steps?.[stepIndex];
      return step ? step.processorNameSnapshot || '' : '';
    },
  },
  {
    key: 'remarks',
    header: 'Remarks',
    width: 25,
    getValue: (order) => order.remarks || '',
  },
  {
    key: 'createdAt',
    header: 'Created At',
    width: 18,
    getValue: (order) => (order.createdAt ? formatDate(order.createdAt) : ''),
  },
];

export function buildCustomFieldColumns(
  customFieldsDef?: CustomFieldDefinition[],
): ExportJobOrderColumnDef[] {
  if (!customFieldsDef || customFieldsDef.length === 0) return [];
  return customFieldsDef.map((def) => ({
    key: `cf_${def.key}`,
    header: def.label,
    width: Math.max(16, def.label.length + 4),
    getValue: (order) => {
      const val = order.customFields?.[def.key];
      return formatCustomFieldValue(val, def);
    },
  }));
}

export interface ExportJobOrdersOptions {
  orders: JobOrder[];
  filename?: string;
  customFieldsDef?: CustomFieldDefinition[];
  visibleColumnKeys?: string[];
  exportAllFields?: boolean;
  format?: 'xlsx' | 'csv';
}

export function exportJobOrdersToExcel({
  orders,
  filename,
  customFieldsDef,
  visibleColumnKeys,
  exportAllFields = true,
  format = 'xlsx',
}: ExportJobOrdersOptions): void {
  const customCols = buildCustomFieldColumns(customFieldsDef);
  const allColumns = [...STANDARD_JOB_ORDER_EXPORT_COLUMNS, ...customCols];

  let selectedCols: ExportJobOrderColumnDef[];
  if (exportAllFields || !visibleColumnKeys || visibleColumnKeys.length === 0) {
    selectedCols = allColumns;
  } else {
    selectedCols = allColumns.filter((col) => {
      if (visibleColumnKeys.includes(col.key)) return true;
      if (col.key === 'route' && visibleColumnKeys.includes('routeNameSnapshot')) return true;
      if (col.key === 'materialBelongsTo' && visibleColumnKeys.includes('ownership')) return true;
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
  const rows: (string | number | null | undefined)[][] = [];

  for (const order of orders) {
    const stepCount = order.steps && order.steps.length > 0 ? order.steps.length : 1;
    for (let stepIdx = 0; stepIdx < stepCount; stepIdx++) {
      const row = selectedCols.map((col) => {
        const val = col.getValue(order, stepIdx, customFieldsDef);
        return val === null || val === undefined ? '' : val;
      });
      rows.push(row);
    }
  }

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
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Job Orders');

  const dateStr = new Date().toISOString().split('T')[0];
  const defaultBaseName = `Job_Orders_${dateStr}`;
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

export async function fetchAllJobOrdersForExport(
  orgId: string,
  params: { search?: string; filter?: string } = {},
  onProgress?: (loaded: number) => void,
): Promise<JobOrder[]> {
  const cleanParams: { search?: string; filter?: string } = {};
  if (params.search && params.search.trim()) cleanParams.search = params.search.trim();
  if (params.filter && params.filter !== 'all' && params.filter.trim()) cleanParams.filter = params.filter.trim();

  const allJobOrders: JobOrder[] = [];
  let currentPage = 1;
  const perPage = 500;
  let hasMore = true;

  while (hasMore) {
    const response = await fetchJobOrders(orgId, {
      ...cleanParams,
      page: currentPage,
      perPage,
    });

    const pageResults = response?.results ?? [];
    allJobOrders.push(...pageResults);

    if (onProgress) {
      onProgress(allJobOrders.length);
    }

    if (response?.pageContext?.hasMore && pageResults.length > 0) {
      currentPage++;
    } else {
      hasMore = false;
    }
  }

  return allJobOrders;
}
