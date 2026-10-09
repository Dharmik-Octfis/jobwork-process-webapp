import * as XLSX from 'xlsx';
import type { StockAdjustmentRow } from '../adjustments.schemas';
import { fetchAdjustments } from '../adjustments.api';
import { adjustmentTypeLabel, adjustmentStatusMeta } from '../adjustments.schemas';
import { formatDate } from '../../../../lib/formatDate';
import { toNumber } from '../../../jobwork/jobwork.schemas';

export interface ExportAdjustmentColumnDef {
  key: string;
  header: string;
  width?: number;
  getValue: (row: StockAdjustmentRow) => string | number | null | undefined;
}

export const STANDARD_ADJUSTMENT_EXPORT_COLUMNS: ExportAdjustmentColumnDef[] = [
  {
    key: 'adjustmentNumber',
    header: 'Adjustment Number',
    width: 22,
    getValue: (r) => r.adjustmentNumber,
  },
  {
    key: 'adjustmentDate',
    header: 'Adjustment Date',
    width: 16,
    getValue: (r) => (r.adjustmentDate ? formatDate(r.adjustmentDate) : ''),
  },
  {
    key: 'adjustmentType',
    header: 'Adjustment Type',
    width: 16,
    getValue: (r) => adjustmentTypeLabel(r.adjustmentType),
  },
  {
    key: 'items',
    header: 'Items',
    width: 30,
    getValue: (r) => {
      if (!r.lines || r.lines.length === 0) return '-';
      return r.lines.map((l) => l.item.name).join(', ');
    },
  },
  {
    key: 'location',
    header: 'Location',
    width: 20,
    getValue: (r) => r.location?.name || '',
  },
  {
    key: 'adjustedAmount',
    header: 'Adjusted Quantity / Value',
    width: 24,
    getValue: (r) => {
      if (!r.lines || r.lines.length === 0) return 0;
      if (r.lines.length === 1) {
        if (r.adjustmentType === 'value') {
          return toNumber(r.lines[0]?.valueAdjusted);
        }
        return toNumber(r.lines[0]?.quantityAdjusted);
      }
      return `${r.lines.length} items`;
    },
  },
  {
    key: 'reason',
    header: 'Reason',
    width: 20,
    getValue: (r) => r.reason?.name || '',
  },
  {
    key: 'status',
    header: 'Status',
    width: 16,
    getValue: (r) => adjustmentStatusMeta(r.status).label,
  },
  {
    key: 'referenceNumber',
    header: 'Reference Number',
    width: 20,
    getValue: (r) => r.referenceNumber || '',
  },
  {
    key: 'description',
    header: 'Description',
    width: 30,
    getValue: (r) => r.description || '',
  },
];

export interface ExportAdjustmentsOptions {
  adjustments: StockAdjustmentRow[];
  filename?: string;
  format?: 'xlsx' | 'csv';
}

export function exportAdjustmentsToExcel({
  adjustments,
  filename,
  format = 'xlsx',
}: ExportAdjustmentsOptions): void {
  const headers = STANDARD_ADJUSTMENT_EXPORT_COLUMNS.map((c) => c.header);
  const rows = adjustments.map((item) =>
    STANDARD_ADJUSTMENT_EXPORT_COLUMNS.map((col) => {
      const val = col.getValue(item);
      return val === null || val === undefined ? '' : val;
    }),
  );

  const worksheetData = [headers, ...rows];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  const colWidths = STANDARD_ADJUSTMENT_EXPORT_COLUMNS.map((col, idx) => {
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
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Adjustments');

  const dateStr = new Date().toISOString().split('T')[0];
  const defaultBaseName = `Inventory_Adjustments_${dateStr}`;
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

export async function fetchAllAdjustmentsForExport(
  orgId: string,
  params: { search?: string } = {},
  onProgress?: (loaded: number) => void,
): Promise<StockAdjustmentRow[]> {
  const allAdjustments: StockAdjustmentRow[] = [];
  let currentPage = 1;
  const perPage = 500;
  let hasMore = true;

  while (hasMore) {
    const response = await fetchAdjustments(orgId, {
      ...params,
      page: currentPage,
      perPage,
    });

    const pageResults = response.results ?? [];
    allAdjustments.push(...pageResults);

    if (onProgress) {
      onProgress(allAdjustments.length);
    }

    if (response.pageContext?.hasMore && pageResults.length > 0) {
      currentPage++;
    } else {
      hasMore = false;
    }
  }

  return allAdjustments;
}
