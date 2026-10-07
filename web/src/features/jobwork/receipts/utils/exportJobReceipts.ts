import * as XLSX from 'xlsx';
import { formatDate } from '../../../../lib/formatDate';
import { RECEIPT_STATUS_META, statusMeta } from '../../jobwork.schemas';
import { reportsApi, type JobworkReceiptsQuery, type JobworkReceiptRow } from '../../../reports/reports.api';
import type { JobReceipt } from '../jobReceipts.schemas';

export const JOB_RECEIPT_EXPORT_HEADERS = [
  'DATE',
  'RECEIPT#',
  'PROCESSOR',
  'PROCESS',
  'JOB ORDER#',
  'ITEMS',
  'PLANNED QTY',
  'RECEIVE QTY',
  'TO BE RECEIVED QTY',
  'STATUS',
];

export function transformReceiptReportRowsToExport(rows: JobworkReceiptRow[]): (string | number)[][] {
  const exportRows: (string | number)[][] = [];

  for (const row of rows) {
    const formattedDate = row.receiptDate ? formatDate(row.receiptDate) : '';
    const statusLabel =
      RECEIPT_STATUS_META[row.status as keyof typeof RECEIPT_STATUS_META]?.label || row.status || 'Posted';

    if (row.lines && row.lines.length > 0) {
      for (const line of row.lines) {
        exportRows.push([
          formattedDate,
          row.receiptNumber || '',
          row.processorName || 'In-house',
          row.process || '',
          row.jobOrderNumber || '',
          line.items || '',
          line.plannedQty !== undefined && line.plannedQty !== null ? Number(line.plannedQty.toFixed(2)) : 0,
          line.receivedQty !== undefined && line.receivedQty !== null ? Number(line.receivedQty.toFixed(2)) : 0,
          line.toBeReceivedQty !== undefined && line.toBeReceivedQty !== null ? Number(line.toBeReceivedQty.toFixed(2)) : 0,
          statusLabel,
        ]);
      }
    } else {
      exportRows.push([
        formattedDate,
        row.receiptNumber || '',
        row.processorName || 'In-house',
        row.process || '',
        row.jobOrderNumber || '',
        '',
        0,
        0,
        0,
        statusLabel,
      ]);
    }
  }

  return exportRows;
}

export function transformJobReceiptsToExport(receipts: JobReceipt[]): (string | number)[][] {
  const exportRows: (string | number)[][] = [];

  for (const receipt of receipts) {
    const formattedDate = receipt.receiptDate ? formatDate(receipt.receiptDate) : '';
    const meta = statusMeta(RECEIPT_STATUS_META, receipt.status);
    const statusLabel = meta.label || receipt.status || 'Posted';
    const processor = receipt.processorNameSnapshot || 'In-house';
    const jobOrderNo = receipt.jobOrder?.jobOrderNumber || '';
    const process = (receipt as unknown as Record<string, unknown>).processName as string || '';

    if (receipt.outputs && receipt.outputs.length > 0) {
      for (const output of receipt.outputs) {
        const itemObj = output.item as { name?: string; unit?: string } | undefined;
        const itemName = itemObj?.name || (output as unknown as Record<string, unknown>).itemName || 'Item';
        const unit = itemObj?.unit || (output as unknown as Record<string, unknown>).uomName || '';
        const itemDisplay = unit ? `${itemName} (${unit})` : String(itemName);
        const receivedQty = Number(output.receivedQty) || 0;
        const plannedQty = Number((receipt as unknown as Record<string, unknown>).plannedQty) || receivedQty;
        const toBeReceivedQty = Math.max(0, plannedQty - receivedQty);

        exportRows.push([
          formattedDate,
          receipt.receiptNumber || '',
          processor,
          process,
          jobOrderNo,
          itemDisplay,
          Number(plannedQty.toFixed(2)),
          Number(receivedQty.toFixed(2)),
          Number(toBeReceivedQty.toFixed(2)),
          statusLabel,
        ]);
      }
    } else {
      const totalReceived = Number(receipt.totalReceivedQty) || 0;
      exportRows.push([
        formattedDate,
        receipt.receiptNumber || '',
        processor,
        process,
        jobOrderNo,
        '',
        Number(totalReceived.toFixed(2)),
        Number(totalReceived.toFixed(2)),
        0,
        statusLabel,
      ]);
    }
  }

  return exportRows;
}

export interface ExportJobReceiptsOptions {
  rows?: JobworkReceiptRow[];
  receipts?: JobReceipt[];
  filename?: string;
  format?: 'xlsx' | 'csv';
}

export function exportJobReceiptsToExcel({
  rows,
  receipts,
  filename,
  format = 'xlsx',
}: ExportJobReceiptsOptions): void {
  let tableData: (string | number)[][];

  if (rows && rows.length > 0) {
    tableData = transformReceiptReportRowsToExport(rows);
  } else if (receipts && receipts.length > 0) {
    tableData = transformJobReceiptsToExport(receipts);
  } else {
    tableData = [];
  }

  const worksheetData = [JOB_RECEIPT_EXPORT_HEADERS, ...tableData];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  const colWidths = [
    { wch: 14 }, // DATE
    { wch: 18 }, // RECEIPT#
    { wch: 22 }, // PROCESSOR
    { wch: 16 }, // PROCESS
    { wch: 18 }, // JOB ORDER#
    { wch: 26 }, // ITEMS
    { wch: 16 }, // PLANNED QTY
    { wch: 16 }, // RECEIVE QTY
    { wch: 20 }, // TO BE RECEIVED QTY
    { wch: 14 }, // STATUS
  ];
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Jobwork Receipts');

  const dateStr = new Date().toISOString().split('T')[0];
  const defaultBaseName = `Jobwork_Receipt_Register_${dateStr}`;
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

export async function fetchAllJobReceiptsForExport(
  orgId: string,
  query: Partial<JobworkReceiptsQuery> = {},
  onProgress?: (loaded: number) => void,
): Promise<JobworkReceiptRow[]> {
  const cleanQuery: JobworkReceiptsQuery = {};
  if (query.processorName?.trim()) cleanQuery.processorName = query.processorName.trim();
  if (query.processName?.trim()) cleanQuery.processName = query.processName.trim();
  if (query.jobOrderNumber?.trim()) cleanQuery.jobOrderNumber = query.jobOrderNumber.trim();
  if (query.itemName?.trim()) cleanQuery.itemName = query.itemName.trim();
  if (query.fromDate) cleanQuery.fromDate = query.fromDate;
  if (query.toDate) cleanQuery.toDate = query.toDate;
  if (query.minAgeDays !== undefined) cleanQuery.minAgeDays = query.minAgeDays;

  const allRows: JobworkReceiptRow[] = [];
  let currentPage = 1;
  const perPage = 500;
  let hasMore = true;

  while (hasMore) {
    const response = await reportsApi.getJobworkReceipts(orgId, {
      ...cleanQuery,
      page: currentPage,
      perPage,
    });

    const pageResults = response?.results ?? [];
    allRows.push(...pageResults);

    if (onProgress) {
      onProgress(allRows.length);
    }

    if (pageResults.length >= perPage && allRows.length < (response?.total || 0)) {
      currentPage++;
    } else {
      hasMore = false;
    }
  }

  return allRows;
}
