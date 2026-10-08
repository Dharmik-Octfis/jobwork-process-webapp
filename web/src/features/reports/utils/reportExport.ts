import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface ReportColumnExportDef {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
  width?: number;
}

export interface ExportReportOptions {
  orgName: string;
  reportTitle: string;
  dateSubtitle: string;
  columns: ReportColumnExportDef[];
  data: (
    | string
    | number
    | {
        content: string | number;
        colSpan?: number;
        rowSpan?: number;
        styles?: Record<string, unknown>;
      }
  )[][];
  totalRow?: (string | number)[];
  footnote?: string;
  filename: string;
  orientation?: 'portrait' | 'landscape';
  customHead?: unknown[];
}

export function exportReportToExcel({
  columns,
  data,
  totalRow,
  filename,
  reportTitle,
}: Pick<ExportReportOptions, 'columns' | 'data' | 'totalRow' | 'filename' | 'reportTitle'>): void {
  const headers = columns.map((c) => c.label);
  const rows: (string | number)[][] = [];
  for (const row of data) {
    if (row.length === 1 && typeof row[0] === 'object' && row[0] !== null && 'content' in row[0]) {
      rows.push([row[0].content as string | number]);
    } else {
      rows.push(
        row.map((cell) => {
          if (typeof cell === 'object' && cell !== null && 'content' in cell) {
            return cell.content as string | number;
          }
          return cell === null || cell === undefined ? '' : cell;
        }),
      );
    }
  }

  if (totalRow && totalRow.length > 0) {
    rows.push(totalRow);
  }

  const worksheetData = [headers, ...rows];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  const colWidths = columns.map((col, idx) => {
    let maxLen = col.label.length;
    for (const row of rows) {
      const cellVal = row[idx];
      if (cellVal !== undefined && cellVal !== null) {
        const strLen = String(cellVal).length;
        if (strLen > maxLen) maxLen = strLen;
      }
    }
    return { wch: Math.min(Math.max(maxLen + 3, col.width || 14), 50) };
  });
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  const safeSheetName = (reportTitle || 'Report').slice(0, 31);
  XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName);

  const finalFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  XLSX.writeFile(workbook, finalFilename, { bookType: 'xlsx' });
}

export async function exportReportToPDF({
  orgName,
  reportTitle,
  dateSubtitle,
  columns,
  data,
  totalRow,
  footnote,
  filename,
  orientation = 'landscape',
  customHead,
}: ExportReportOptions): Promise<void> {
  const doc = new jsPDF({
    orientation,
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Draw Header
  let currentY = 36;

  // Org Name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(17, 24, 39);
  doc.text(orgName || 'OCTFIS TECHNO LLP', pageWidth / 2, currentY, { align: 'center' });

  // Report Title
  currentY += 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(55, 65, 81);
  doc.text(reportTitle, pageWidth / 2, currentY, { align: 'center' });

  // Date Subtitle
  if (dateSubtitle) {
    currentY += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(107, 114, 128);
    doc.text(dateSubtitle, pageWidth / 2, currentY, { align: 'center' });
  }

  // Column styles mapping for text alignment
  const columnStyles: Record<number, { halign: 'left' | 'center' | 'right' }> = {};
  columns.forEach((col, idx) => {
    columnStyles[idx] = { halign: col.align || 'left' };
  });

  const headers = customHead || [
    columns.map((c) => ({
      content: c.label,
      styles: { halign: c.align || 'left' },
    })),
  ];
  const bodyRows = data.map((row) =>
    row.map((cell) => {
      if (typeof cell === 'object' && cell !== null && 'content' in cell) {
        return cell;
      }
      return cell === null || cell === undefined || cell === '' ? '-' : String(cell);
    }),
  );

  const footRows =
    totalRow && totalRow.length > 0
      ? [
          totalRow.map((cell, idx) => ({
            content: cell === null || cell === undefined || cell === '' ? '' : String(cell),
            styles: { halign: columns[idx]?.align || (idx === 0 ? 'left' : 'right') },
          })),
        ]
      : undefined;

  autoTable(doc, {
    startY: currentY + 16,
    head: headers as unknown as string[][],
    body: bodyRows,
    foot: footRows as unknown as { content: string; styles: Record<string, unknown> }[][],
    showFoot: 'lastPage',
    theme: 'plain',
    margin: { left: 28, right: 28, top: 32, bottom: 32 },
    styles: {
      font: 'helvetica',
      fontSize: 8,
      textColor: [31, 41, 55],
      cellPadding: { top: 5, bottom: 5, left: 5, right: 5 },
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [243, 244, 246],
      textColor: [55, 65, 81],
      fontStyle: 'bold',
      fontSize: 8,
      lineWidth: { top: 0.5, bottom: 0.5 },
      lineColor: [209, 213, 219],
    },
    bodyStyles: {
      lineWidth: { bottom: 0.5 },
      lineColor: [243, 244, 246],
    },
    alternateRowStyles: {
      fillColor: [250, 250, 250],
    },
    footStyles: {
      fillColor: [255, 255, 255],
      textColor: [17, 24, 39],
      fontStyle: 'bold',
      fontSize: 8.5,
      lineWidth: { top: 1, bottom: 1 },
      lineColor: [55, 65, 81],
    },
    columnStyles,
    didDrawPage: (_data) => {
      // Optional: page footer or watermarks
    },
  });

  // Render footnote if present
  const lastTableY =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ||
    currentY + 40;
  if (footnote) {
    if (lastTableY + 30 > pageHeight - 30) {
      doc.addPage();
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(107, 114, 128);
      doc.text(footnote, 28, 40);
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(107, 114, 128);
      doc.text(footnote, 28, lastTableY + 20);
    }
  }

  const finalPdfFilename = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  doc.save(finalPdfFilename);
}
