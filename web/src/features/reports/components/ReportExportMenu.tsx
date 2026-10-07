import { useState, useRef, useEffect } from 'react';
import { Download, ChevronDown, FileSpreadsheet, FileText } from 'lucide-react';
import { notify } from '../../../lib/notify';
import {
  exportReportToExcel,
  exportReportToPDF,
  type ReportColumnExportDef,
} from '../utils/reportExport';

export interface ReportExportMenuProps {
  orgName?: string;
  reportTitle: string;
  dateSubtitle?: string;
  columns?: ReportColumnExportDef[];
  data?: (string | number | { content: string | number; colSpan?: number; rowSpan?: number; styles?: any })[][];
  totalRow?: (string | number)[];
  footnote?: string;
  filename?: string;
  orientation?: 'portrait' | 'landscape';
  disabled?: boolean;
  customHead?: any[];
  onExportExcel?: () => void | Promise<void>;
  onExportPDF?: () => void | Promise<void>;
  fetchExportData?: () => Promise<{
    data: (string | number | { content: string | number; colSpan?: number; rowSpan?: number; styles?: any })[][];
    totalRow?: (string | number)[];
  }>;
}

export function ReportExportMenu({
  orgName = 'OCTFIS TECHNO LLP',
  reportTitle,
  dateSubtitle = '',
  columns = [],
  data = [],
  totalRow,
  footnote,
  filename,
  orientation,
  disabled = false,
  customHead,
  onExportExcel,
  onExportPDF,
  fetchExportData,
}: ReportExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const baseFilename =
    filename ||
    `${reportTitle.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}`;

  const handleExportXLSX = async () => {
    try {
      setIsExporting(true);
      if (onExportExcel) {
        await onExportExcel();
      } else {
        let exportData = data;
        let exportTotal = totalRow;

        if (fetchExportData) {
          notify.info('Fetching all records for Excel export...');
          const res = await fetchExportData();
          exportData = res.data;
          exportTotal = res.totalRow ?? totalRow;
        }

        if (exportData.length === 0) {
          notify.error('No records to export.');
          return;
        }

        exportReportToExcel({
          columns,
          data: exportData,
          totalRow: exportTotal,
          filename: baseFilename,
          reportTitle,
        });
        notify.success(`Successfully exported ${exportData.length} records as Excel.`);
      }
    } catch (err) {
      console.error('Failed to export Excel:', err);
      notify.error('Failed to export Excel file. Please try again.');
    } finally {
      setIsExporting(false);
      setIsOpen(false);
    }
  };

  const handleExportPDF = async () => {
    try {
      setIsExporting(true);
      if (onExportPDF) {
        await onExportPDF();
      } else {
        let exportData = data;
        let exportTotal = totalRow;

        if (fetchExportData) {
          notify.info('Fetching all records for PDF export...');
          const res = await fetchExportData();
          exportData = res.data;
          exportTotal = res.totalRow ?? totalRow;
        }

        if (exportData.length === 0) {
          notify.error('No records to export.');
          return;
        }

        notify.info(`Generating PDF for ${exportData.length} records...`);
        await exportReportToPDF({
          orgName,
          reportTitle,
          dateSubtitle,
          columns,
          data: exportData,
          totalRow: exportTotal,
          footnote,
          filename: baseFilename,
          orientation: orientation || (columns.length > 5 ? 'landscape' : 'portrait'),
          customHead,
        });
        notify.success(`Successfully exported ${exportData.length} records as PDF.`);
      }
    } catch (err) {
      console.error('Failed to export PDF:', err);
      notify.error('Failed to export PDF file. Please try again.');
    } finally {
      setIsExporting(false);
      setIsOpen(false);
    }
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled || isExporting}
        title="Export Report"
        aria-label="Export Report"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          borderRadius: '4px',
          border: '1px solid #d1d5db',
          background: '#fff',
          color: '#374151',
          fontSize: '13px',
          fontWeight: 500,
          cursor: disabled || isExporting ? 'not-allowed' : 'pointer',
          opacity: disabled || isExporting ? 0.6 : 1,
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => {
          if (!disabled && !isExporting) e.currentTarget.style.background = '#f9fafb';
        }}
        onMouseLeave={(e) => {
          if (!disabled && !isExporting) e.currentTarget.style.background = '#fff';
        }}
      >
        <Download size={14} color="#166534" />
        <span>Export</span>
        <ChevronDown size={14} color="#6b7280" />
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '4px',
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
            minWidth: '190px',
            zIndex: 100,
            padding: '4px 0',
          }}
        >
          <button
            type="button"
            onClick={handleExportPDF}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 14px',
              background: 'none',
              border: 'none',
              fontSize: '13px',
              color: '#1e293b',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            <FileText size={15} color="#dc2626" />
            <span>Export as PDF</span>
          </button>

          <button
            type="button"
            onClick={handleExportXLSX}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 14px',
              background: 'none',
              border: 'none',
              fontSize: '13px',
              color: '#1e293b',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            <FileSpreadsheet size={15} color="#166534" />
            <span>Export as Excel (XLSX)</span>
          </button>
        </div>
      )}
    </div>
  );
}
