import * as XLSX from 'xlsx';
import { formatDate } from '../../../../lib/formatDate';
import { ISSUE_STATUS_META, statusMeta } from '../../jobwork.schemas';
import { reportsApi, type JobworkChallansQuery, type JobworkChallanRow } from '../../../reports/reports.api';
import type { JobIssue } from '../jobIssues.schemas';

export interface ExportJobChallanRow {
  issueDate: string;
  challanNumber: string;
  processorName: string;
  process: string;
  jobOrderNumber: string;
  items: string;
  plannedQty: number | string;
  issuedQty: number | string;
  toBeIssuedQty: number | string;
  daysOutstanding: number | string;
  status: string;
}

export const JOB_CHALLAN_EXPORT_HEADERS = [
  'DATE',
  'CHALLAN#',
  'PROCESSOR',
  'PROCESS',
  'JOB ORDER#',
  'ITEMS',
  'PLANNED',
  'ISSUE',
  'TO BE ISSUE',
  'DAYS OUTSTANDING',
  'STATUS',
];

export function transformChallanReportRowsToExport(rows: JobworkChallanRow[]): (string | number)[][] {
  const exportRows: (string | number)[][] = [];

  for (const row of rows) {
    const formattedDate = row.issueDate ? formatDate(row.issueDate) : '';
    const statusLabel =
      ISSUE_STATUS_META[row.status as keyof typeof ISSUE_STATUS_META]?.label || row.status || '';
    const daysOut = row.daysOutstanding !== null && row.daysOutstanding !== undefined ? row.daysOutstanding : '-';

    if (row.lines && row.lines.length > 0) {
      for (const line of row.lines) {
        exportRows.push([
          formattedDate,
          row.challanNumber || '',
          row.processorName || 'In-house',
          row.process || '',
          row.jobOrderNumber || '',
          line.items || '',
          line.plannedQty !== undefined && line.plannedQty !== null ? Number(line.plannedQty.toFixed(2)) : 0,
          line.issuedQty !== undefined && line.issuedQty !== null ? Number(line.issuedQty.toFixed(2)) : 0,
          line.toBeIssuedQty !== undefined && line.toBeIssuedQty !== null ? Number(line.toBeIssuedQty.toFixed(2)) : 0,
          daysOut,
          statusLabel,
        ]);
      }
    } else {
      exportRows.push([
        formattedDate,
        row.challanNumber || '',
        row.processorName || 'In-house',
        row.process || '',
        row.jobOrderNumber || '',
        '',
        0,
        0,
        0,
        daysOut,
        statusLabel,
      ]);
    }
  }

  return exportRows;
}

export function transformJobIssuesToExport(issues: JobIssue[]): (string | number)[][] {
  const exportRows: (string | number)[][] = [];

  for (const issue of issues) {
    const formattedDate = issue.issueDate ? formatDate(issue.issueDate) : '';
    const meta = statusMeta(ISSUE_STATUS_META, issue.status);
    const statusLabel = meta.label || issue.status || '';
    const processor = issue.processorNameSnapshot || issue.destination?.name || 'In-house';
    const process = issue.step?.processNameSnapshot || '';
    const jobOrderNo = issue.jobOrder?.jobOrderNumber || '';

    const daysOut = issue.issueDate
      ? Math.max(0, Math.floor((Date.now() - new Date(issue.issueDate).getTime()) / (1000 * 60 * 60 * 24)))
      : '-';

    const plannedInput = issue.step?.plannedInputQty ? Number(issue.step.plannedInputQty) : 0;

    if (issue.lines && issue.lines.length > 0) {
      for (const line of issue.lines) {
        const itemObj = line.item as { name?: string; unit?: string } | undefined;
        const itemName = itemObj?.name || (line as unknown as Record<string, unknown>).itemName || 'Item';
        const unit = itemObj?.unit || line.uom?.unitName || '';
        const itemDisplay = unit ? `${itemName} (${unit})` : String(itemName);
        const issuedQty = Number(line.qty) || 0;
        const plannedQty = plannedInput || issuedQty;
        const toBeIssuedQty = Math.max(0, plannedQty - issuedQty);

        exportRows.push([
          formattedDate,
          issue.challanNumber || '',
          processor,
          process,
          jobOrderNo,
          itemDisplay,
          Number(plannedQty.toFixed(2)),
          Number(issuedQty.toFixed(2)),
          Number(toBeIssuedQty.toFixed(2)),
          daysOut,
          statusLabel,
        ]);
      }
    } else {
      const totalQty = Number(issue.totalQty) || 0;
      exportRows.push([
        formattedDate,
        issue.challanNumber || '',
        processor,
        process,
        jobOrderNo,
        '',
        Number(plannedInput.toFixed(2)),
        Number(totalQty.toFixed(2)),
        Math.max(0, plannedInput - totalQty),
        daysOut,
        statusLabel,
      ]);
    }
  }

  return exportRows;
}

export interface ExportJobChallansOptions {
  rows?: JobworkChallanRow[];
  issues?: JobIssue[];
  filename?: string;
  format?: 'xlsx' | 'csv';
}

export function exportJobChallansToExcel({
  rows,
  issues,
  filename,
  format = 'xlsx',
}: ExportJobChallansOptions): void {
  let tableData: (string | number)[][];

  if (rows && rows.length > 0) {
    tableData = transformChallanReportRowsToExport(rows);
  } else if (issues && issues.length > 0) {
    tableData = transformJobIssuesToExport(issues);
  } else {
    tableData = [];
  }

  const worksheetData = [JOB_CHALLAN_EXPORT_HEADERS, ...tableData];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  const colWidths = [
    { wch: 14 }, // DATE
    { wch: 18 }, // CHALLAN#
    { wch: 22 }, // PROCESSOR
    { wch: 16 }, // PROCESS
    { wch: 18 }, // JOB ORDER#
    { wch: 26 }, // ITEMS
    { wch: 14 }, // PLANNED
    { wch: 14 }, // ISSUE
    { wch: 16 }, // TO BE ISSUE
    { wch: 18 }, // DAYS OUTSTANDING
    { wch: 14 }, // STATUS
  ];
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Jobwork Challans');

  const dateStr = new Date().toISOString().split('T')[0];
  const defaultBaseName = `Jobwork_Challan_Register_${dateStr}`;
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

export async function fetchAllJobChallansForExport(
  orgId: string,
  query: Partial<JobworkChallansQuery> = {},
  onProgress?: (loaded: number) => void,
): Promise<JobworkChallanRow[]> {
  const cleanQuery: JobworkChallansQuery = {};
  if (query.processorName?.trim()) cleanQuery.processorName = query.processorName.trim();
  if (query.processName?.trim()) cleanQuery.processName = query.processName.trim();
  if (query.jobOrderNumber?.trim()) cleanQuery.jobOrderNumber = query.jobOrderNumber.trim();
  if (query.itemName?.trim()) cleanQuery.itemName = query.itemName.trim();
  if (query.fromDate) cleanQuery.fromDate = query.fromDate;
  if (query.toDate) cleanQuery.toDate = query.toDate;
  if (query.minAgeDays !== undefined) cleanQuery.minAgeDays = query.minAgeDays;

  const allRows: JobworkChallanRow[] = [];
  let currentPage = 1;
  const perPage = 500;
  let hasMore = true;

  while (hasMore) {
    const response = await reportsApi.getJobworkChallans(orgId, {
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
