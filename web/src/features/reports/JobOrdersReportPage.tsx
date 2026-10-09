import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X, Filter, Columns, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { format, startOfMonth } from 'date-fns';
import { notify } from '../../lib/notify';
import { AdvancedFilter } from '../../components/ui/AdvancedFilter/AdvancedFilter';
import type { FilterField, FilterCondition } from '../../components/ui/AdvancedFilter/filterUtils';
import { CustomizeColumnsModal } from '../../components/ui/CustomizeColumnsModal';
import { Pagination } from '../../components/ui/Pagination';
import { ReportDateFilter } from './components/ReportDateFilter';
import { useListSearch } from '../../hooks/useListSearch';
import { useOrganizationName } from '../../hooks/useOrganizationName';
import { useRecordReportVisit } from './useRecordReportVisit';
import { reportsApi, type JobOrdersReportQuery, type JobOrdersReportRow } from './reports.api';
import { useActiveCustomFields } from '../custom-fields/customFields.api';
import { JOB_ORDER_STATUS_META } from '../jobwork/jobwork.schemas';
import { fetchProcesses } from '../jobwork/processes/processes.api';
import { fetchVendors } from '../purchases/vendors/vendors.api';
import { fetchRoutes } from '../jobwork/process-routes/processRoutes.api';
import { useTableSort } from '../../hooks/useTableSort';
import { SortableHeader } from '../../components/ui/SortableHeader';
import { ReportExportMenu } from './components/ReportExportMenu';

const COLUMN_CATALOG = [
  { key: 'jobOrderNumber', label: 'JOB ORDER#', locked: true, defaultVisible: true },
  { key: 'orderDate', label: 'DATE', locked: true, defaultVisible: true },
  { key: 'targetDate', label: 'TARGET DATE', defaultVisible: true },
  { key: 'route', label: 'ROUTE', defaultVisible: true },
  { key: 'materialBelongsTo', label: 'MATERIAL BELONGS TO', defaultVisible: true },
  { key: 'status', label: 'STATUS', defaultVisible: true },
  { key: 'challans', label: 'CHALLANS', defaultVisible: true },
  { key: 'receipts', label: 'RECEIPTS', defaultVisible: true },
  { key: 'process', label: 'PROCESS', defaultVisible: true },
  { key: 'doneBy', label: 'DONE BY', defaultVisible: true },
  { key: 'processorName', label: 'PROCESSOR', defaultVisible: true },
];

const RIGHT_ALIGNED = new Set<string>();

interface Applied {
  conditions: FilterCondition[];
  fromDate: Date;
  toDate: Date;
}

export function JobOrdersReportPage() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const organizationName = useOrganizationName();
  useRecordReportVisit(orgId, 'job_order_report');

  const storageKey = `jobOrdersReportState_${orgId}`;
  const initialState = useMemo(() => {
    try {
      const stored = orgId ? sessionStorage.getItem(storageKey) : null;
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      const safeDate = (val: string | number | null | undefined, fallback: Date) => {
        if (!val) return fallback;
        const d = new Date(val);
        return isNaN(d.getTime()) ? fallback : d;
      };
      return {
        dateRange: parsed.dateRange || 'This Month',
        fromDate: safeDate(parsed.fromDate, startOfMonth(new Date())),
        toDate: safeDate(parsed.toDate, new Date()),
        conditions: (parsed.conditions as FilterCondition[]) || [],
        applied: {
          conditions: (parsed.applied?.conditions as FilterCondition[]) || [],
          fromDate: safeDate(parsed.applied?.fromDate, startOfMonth(new Date())),
          toDate: safeDate(parsed.applied?.toDate, new Date()),
        } satisfies Applied,
      };
    } catch {
      return null;
    }
  }, [orgId, storageKey]);

  const [dateRange, setDateRange] = useState(initialState?.dateRange || 'This Month');
  const [fromDate, setFromDate] = useState<Date>(
    initialState?.fromDate || startOfMonth(new Date()),
  );
  const [toDate, setToDate] = useState<Date>(initialState?.toDate || new Date());
  const [conditions, setConditions] = useState<FilterCondition[]>(initialState?.conditions ?? []);
  const [applied, setApplied] = useState<Applied>(
    initialState?.applied ?? {
      conditions: [],
      fromDate: startOfMonth(new Date()),
      toDate: new Date(),
    },
  );
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ dateRange, fromDate, toDate, conditions, applied }),
    );
  }, [orgId, storageKey, dateRange, fromDate, toDate, conditions, applied]);

  const [showColumnsModal, setShowColumnsModal] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    COLUMN_CATALOG.filter((col) => col.defaultVisible).map((col) => col.key),
  );

  const { data: customFields = [] } = useActiveCustomFields(orgId, 'job_order');

  const { data: processesPage } = useQuery({
    queryKey: ['processes', orgId],
    queryFn: () => fetchProcesses(orgId!, { perPage: 500 }),
    enabled: Boolean(orgId),
  });
  const processes = useMemo(() => processesPage?.results || [], [processesPage?.results]);

  const { data: vendorsPage } = useQuery({
    queryKey: ['vendors', orgId],
    queryFn: () => fetchVendors(orgId!, { perPage: 500 }),
    enabled: Boolean(orgId),
  });
  const processors = useMemo(() => vendorsPage?.results || [], [vendorsPage?.results]);

  const { data: routesPage } = useQuery({
    queryKey: ['routes', orgId],
    queryFn: () => fetchRoutes(orgId!, { perPage: 500 }),
    enabled: Boolean(orgId),
  });
  const availableRoutes = useMemo(() => routesPage?.results || [], [routesPage?.results]);

  const customFilterFields = useMemo(() => {
    return customFields.map((cf) => {
      let dataType: FilterField['dataType'] = 'string';
      if (cf.dataType === 'checkbox') dataType = 'boolean';
      if (cf.dataType === 'date') dataType = 'date';
      if (cf.dataType === 'number' || cf.dataType === 'decimal') dataType = 'number';

      const options = cf.config?.options?.map((opt) => ({ label: opt.label, value: opt.id }));
      if (cf.dataType === 'select' || cf.dataType === 'multi_select') dataType = 'select';

      return {
        key: `cf_${cf.key}`,
        label: cf.label,
        dataType,
        group: 'Custom Fields',
        options: options,
      } as FilterField;
    });
  }, [customFields]);

  const filterFields = useMemo<FilterField[]>(() => {
    const statusOptions = Object.entries(JOB_ORDER_STATUS_META).map(([key, meta]) => ({
      label: meta.label,
      value: key,
    }));

    const processOptions = processes.map((p) => ({ label: p.name, value: p.name }));
    const processorOptions = processors.map((v) => ({
      label: v.contactName,
      value: v.contactName,
    }));
    const routeOptions = availableRoutes.map((r) => ({ label: r.name, value: r.name }));

    return [
      { key: 'jobOrderNumber', label: 'Job Order#', dataType: 'string', group: 'Report' },
      { key: 'targetDate', label: 'Target Date', dataType: 'date', group: 'Report' },
      {
        key: 'routeName',
        label: 'Route',
        dataType: 'select',
        options: routeOptions,
        group: 'Report',
      },
      {
        key: 'ownership',
        label: 'Material Belongs To',
        dataType: 'select',
        options: [
          { label: 'Ours', value: 'own' },
          { label: 'Customer’s', value: 'customer' },
        ],
        group: 'Report',
      },
      {
        key: 'status',
        label: 'Status',
        dataType: 'select',
        options: statusOptions,
        group: 'Report',
      },
      {
        key: 'processName',
        label: 'Process',
        dataType: 'select',
        options: processOptions,
        group: 'Report',
      },
      {
        key: 'processorType',
        label: 'Done By',
        dataType: 'select',
        options: [
          { label: 'In-house', value: 'in_house' },
          { label: 'Vendor', value: 'vendor' },
        ],
        group: 'Report',
      },
      {
        key: 'processorName',
        label: 'Processor',
        dataType: 'select',
        options: processorOptions,
        group: 'Report',
      },
      ...customFilterFields,
    ];
  }, [customFilterFields, processes, processors, availableRoutes]);

  const { page, setPage, perPage, setPerPage } = useListSearch();

  const query = useMemo<JobOrdersReportQuery>(() => {
    const valueOf = (field: string) => {
      const value = applied.conditions.find((c) => c.field === field)?.value;
      return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    };

    const dateOf = (field: string, target: 'from' | 'to') => {
      const condition = applied.conditions.find((c) => c.field === field);
      if (!condition) return undefined;

      if (condition.operator === 'between') {
        const val = condition.value as { from?: string; to?: string };
        const res = target === 'from' ? val?.from : val?.to;
        return typeof res === 'string' && res.trim() ? res.trim() : undefined;
      }

      const valStr =
        typeof condition.value === 'string' && condition.value.trim()
          ? condition.value.trim()
          : undefined;

      if (['before', 'on_or_before', 'lt', 'lte'].includes(condition.operator) && target === 'to')
        return valStr;
      if (['after', 'on_or_after', 'gt', 'gte'].includes(condition.operator) && target === 'from')
        return valStr;
      if (['equals', 'contains'].includes(condition.operator)) return valStr;

      return undefined;
    };

    const customFieldKeys = new Set(customFields.map((cf) => cf.key));
    const jobOrderCustomFields: Record<string, unknown> = {};

    for (const c of applied.conditions) {
      const cfKey = c.field.replace('cf_', '');
      if (customFieldKeys.has(cfKey)) {
        jobOrderCustomFields[cfKey] = c.value;
      }
    }

    const q: JobOrdersReportQuery = {
      jobOrderNumber: valueOf('jobOrderNumber'),
      processorName: valueOf('processorName'),
      processName: valueOf('processName'),
      status: valueOf('status'),
      fromDate: format(applied.fromDate, 'yyyy-MM-dd'),
      toDate: format(applied.toDate, 'yyyy-MM-dd'),
      targetDateFrom: dateOf('targetDate', 'from'),
      targetDateTo: dateOf('targetDate', 'to'),
      routeName: valueOf('routeName'),
      ownership: valueOf('ownership'),
      processorType: valueOf('processorType'),
      page,
      perPage,
    };

    if (Object.keys(jobOrderCustomFields).length > 0) {
      q.jobOrderCustomFields = jobOrderCustomFields;
    }

    return q;
  }, [applied, page, perPage, customFields]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', orgId, 'job-orders', query],
    queryFn: () => reportsApi.getJobOrdersReport(orgId!, query),
    enabled: Boolean(orgId),
  });

  const rows = data?.results ?? [];
  const { sortedRows, sortField, sortDirection, handleSort } = useTableSort(rows);
  const total = data?.totalCount ?? 0;

  const handleExportReport = async () => {
    if (!orgId) return;
    try {
      setIsExporting(true);
      notify.info('Preparing report for export...');
      const allData = await reportsApi.getJobOrdersReport(orgId, {
        ...query,
        page: undefined,
        perPage: undefined,
      });

      const reportResults = allData?.results || [];
      if (reportResults.length === 0) {
        notify.error('No report data found to export.');
        return;
      }

      const activeColumns = COLUMN_CATALOG.filter((col) => visibleColumns.includes(col.key));
      const headers = activeColumns.map((col) => col.label);
      const exportRows: (string | number | null | undefined)[][] = [];

      for (const r of reportResults) {
        const rowSpanCount = Math.max(1, r.process.length);
        for (let rowIndex = 0; rowIndex < rowSpanCount; rowIndex++) {
          const rowData = activeColumns.map((col) => {
            switch (col.key) {
              case 'jobOrderNumber':
                return r.jobOrderNumber;
              case 'orderDate':
                return r.orderDate ? format(new Date(r.orderDate), 'dd-MM-yyyy') : '';
              case 'targetDate':
                return r.targetDate ? format(new Date(r.targetDate), 'dd-MM-yyyy') : '';
              case 'route':
                return r.route || '-';
              case 'materialBelongsTo':
                return r.materialBelongsTo || '-';
              case 'status':
                return (
                  JOB_ORDER_STATUS_META[r.status as keyof typeof JOB_ORDER_STATUS_META]?.label ||
                  r.status
                );
              case 'challans':
                return r.challansCount ?? 0;
              case 'receipts':
                return r.receiptsCount ?? 0;
              case 'process':
                return r.process[rowIndex] || '-';
              case 'doneBy':
                return r.doneBy[rowIndex] || '-';
              case 'processorName':
                return r.processorName[rowIndex] || '-';
              default:
                return '';
            }
          });
          exportRows.push(rowData);
        }
      }

      const worksheetData = [headers, ...exportRows];
      const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

      const colWidths = activeColumns.map((col, idx) => {
        let maxLen = col.label.length;
        for (const r of exportRows) {
          const cellVal = r[idx];
          if (cellVal !== undefined && cellVal !== null) {
            const strLen = String(cellVal).length;
            if (strLen > maxLen) maxLen = strLen;
          }
        }
        return { wch: Math.min(Math.max(maxLen + 3, 12), 60) };
      });
      worksheet['!cols'] = colWidths;

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Job Order Report');

      const fromStr = format(applied.fromDate, 'yyyy-MM-dd');
      const toStr = format(applied.toDate, 'yyyy-MM-dd');
      XLSX.writeFile(workbook, `Job_Order_Report_${fromStr}_to_${toStr}.xlsx`, {
        bookType: 'xlsx',
      });
      notify.success(`Successfully exported ${exportRows.length} report rows as XLSX file.`);
    } catch (err) {
      console.error('Failed to export report:', err);
      notify.error('Failed to export report. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const cell = (row: JobOrdersReportRow, key: string, rowIndex: number = 0) => {
    switch (key) {
      case 'jobOrderNumber':
        return (
          <Link
            className="hover-underline"
            to={`/organizations/${orgId}/jobwork/job-orders/${row.id}`}
            style={{ color: '#0062ff', fontWeight: 500 }}
          >
            {row.jobOrderNumber}
          </Link>
        );
      case 'orderDate':
        return format(new Date(row.orderDate), 'dd-MM-yyyy');
      case 'targetDate':
        return row.targetDate ? format(new Date(row.targetDate), 'dd-MM-yyyy') : '-';
      case 'route':
        return row.route || '-';
      case 'materialBelongsTo':
        return row.materialBelongsTo || '-';
      case 'status':
        return (
          JOB_ORDER_STATUS_META[row.status as keyof typeof JOB_ORDER_STATUS_META]?.label ||
          row.status
        );
      case 'challans': {
        const count = row.challansCount ?? 0;
        if (count === 0) {
          return <span style={{ color: '#9ca3af' }}>—</span>;
        }
        return (
          <Link
            to={`/organizations/${orgId}/reports/jobwork-challans?jobOrderNumber=${encodeURIComponent(row.jobOrderNumber)}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#1d4ed8',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              textDecoration: 'none',
              cursor: 'pointer',
            }}
            title={`View ${count} Challan(s) for ${row.jobOrderNumber}`}
          >
            <span>
              {count} {count === 1 ? 'Challan' : 'Challans'}
            </span>
            <span style={{ fontSize: '11px', opacity: 0.8 }}>↗</span>
          </Link>
        );
      }
      case 'receipts': {
        const count = row.receiptsCount ?? 0;
        if (count === 0) {
          return <span style={{ color: '#9ca3af' }}>—</span>;
        }
        return (
          <Link
            to={`/organizations/${orgId}/reports/jobwork-receipts?jobOrderNumber=${encodeURIComponent(row.jobOrderNumber)}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#15803d',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              textDecoration: 'none',
              cursor: 'pointer',
            }}
            title={`View ${count} Receipt(s) for ${row.jobOrderNumber}`}
          >
            <span>
              {count} {count === 1 ? 'Receipt' : 'Receipts'}
            </span>
            <span style={{ fontSize: '11px', opacity: 0.8 }}>↗</span>
          </Link>
        );
      }
      case 'process':
        return row.process[rowIndex] || '-';
      case 'doneBy':
        return row.doneBy[rowIndex] || '-';
      case 'processorName':
        return row.processorName[rowIndex] || '-';
      default:
        return null;
    }
  };

  const exportColumns = useMemo(() => {
    return COLUMN_CATALOG.filter((c) => visibleColumns.includes(c.key)).map((c) => ({
      key: c.key,
      label: c.label,
      align: 'left' as const,
    }));
  }, [visibleColumns]);

  const exportRows = useMemo(() => {
    return rows.map((r) =>
      exportColumns.map((col) => {
        switch (col.key) {
          case 'jobOrderNumber':
            return r.jobOrderNumber || '-';
          case 'orderDate':
            return r.orderDate ? format(new Date(r.orderDate), 'dd-MM-yyyy') : '-';
          case 'targetDate':
            return r.targetDate ? format(new Date(r.targetDate), 'dd-MM-yyyy') : '-';
          case 'route':
            return r.route || '-';
          case 'materialBelongsTo':
            return r.materialBelongsTo || '-';
          case 'status':
            return (
              JOB_ORDER_STATUS_META[r.status as keyof typeof JOB_ORDER_STATUS_META]?.label ||
              r.status
            );
          case 'challans':
            return r.challansCount !== undefined ? String(r.challansCount) : '0';
          case 'receipts':
            return r.receiptsCount !== undefined ? String(r.receiptsCount) : '0';
          case 'process':
            return (r.process || []).join('\n') || '-';
          case 'doneBy':
            return (r.doneBy || []).join('\n') || '-';
          case 'processorName':
            return (r.processorName || []).join('\n') || '-';
          default:
            return '-';
        }
      }),
    );
  }, [rows, exportColumns]);

  const fetchExportData = async () => {
    if (!orgId) return { data: [] };
    const allData = await reportsApi.getJobOrdersReport(orgId, {
      ...query,
      page: undefined,
      perPage: undefined,
    });
    const reportResults = allData?.results || [];
    const out = reportResults.map((r) =>
      exportColumns.map((col) => {
        switch (col.key) {
          case 'jobOrderNumber':
            return r.jobOrderNumber || '-';
          case 'orderDate':
            return r.orderDate ? format(new Date(r.orderDate), 'dd-MM-yyyy') : '-';
          case 'targetDate':
            return r.targetDate ? format(new Date(r.targetDate), 'dd-MM-yyyy') : '-';
          case 'route':
            return r.route || '-';
          case 'materialBelongsTo':
            return r.materialBelongsTo || '-';
          case 'status':
            return (
              JOB_ORDER_STATUS_META[r.status as keyof typeof JOB_ORDER_STATUS_META]?.label ||
              r.status
            );
          case 'challans':
            return r.challansCount !== undefined ? String(r.challansCount) : '0';
          case 'receipts':
            return r.receiptsCount !== undefined ? String(r.receiptsCount) : '0';
          case 'process':
            return (r.process || []).join('\n') || '-';
          case 'doneBy':
            return (r.doneBy || []).join('\n') || '-';
          case 'processorName':
            return (r.processorName || []).join('\n') || '-';
          default:
            return '-';
        }
      }),
    );
    return { data: out };
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#f4f5f7',
        fontFamily:
          '"Zoho Puvi", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          padding: '12px 24px',
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '2px' }}>Job Work</div>
          <div style={{ fontSize: '16px', fontWeight: 500, color: '#111827' }}>
            Job Order Report (Ledger View)
            <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: '6px' }}>
              • From {format(applied.fromDate, 'dd-MM-yyyy')} To{' '}
              {format(applied.toDate, 'dd-MM-yyyy')}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ReportExportMenu
            orgName={organizationName || 'OCTFIS TECHNO LLP'}
            reportTitle="Job Order Report"
            dateSubtitle={`From ${format(applied.fromDate, 'dd-MM-yyyy')} To ${format(applied.toDate, 'dd-MM-yyyy')}`}
            columns={exportColumns}
            data={exportRows}
            fetchExportData={fetchExportData}
            onExportExcel={handleExportReport}
          />

          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Close report"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px',
              minWidth: '44px',
              minHeight: '44px',
            }}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '10px 24px',
          background: '#f9fafb',
          borderBottom: '1px solid #e5e7eb',
          gap: '16px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: '#4b5563',
            fontSize: '13px',
            fontWeight: 500,
          }}
        >
          <Filter size={14} color="#6b7280" />
          Filters :
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', flex: 1 }}>
          <ReportDateFilter
            isRange={true}
            value={dateRange}
            onChangeRange={(label, start, end) => {
              setDateRange(label);
              setFromDate(start!);
              setToDate(end!);
            }}
            labelPrefix=""
          />
          <AdvancedFilter
            fields={filterFields}
            conditions={conditions}
            onChange={setConditions}
            align="left"
            matchType="all"
            triggerIcon={
              <span style={{ fontSize: '14px', marginRight: '4px', color: '#2563eb' }}>+</span>
            }
            triggerLabel="More Filters"
            liveUpdate={true}
          />
          <button
            type="button"
            onClick={() => {
              setPage(1);
              setApplied({ conditions, fromDate, toDate });
            }}
            style={{
              padding: '6px 12px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
          >
            Run Report
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ padding: '12px', flex: 1, overflowY: 'auto', minWidth: 0 }}>
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            minHeight: '400px',
            position: 'relative',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
            }}
          >
            <button
              type="button"
              onClick={handleExportReport}
              disabled={isExporting}
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                padding: '6px 12px',
                color: '#166534',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: isExporting ? 'not-allowed' : 'pointer',
                fontWeight: 500,
                opacity: isExporting ? 0.6 : 1,
              }}
            >
              <Download size={14} color="#166534" />
              <span>Export (XLSX)</span>
            </button>

            <button
              type="button"
              onClick={() => setShowColumnsModal(true)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#111827',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              <Columns size={14} color="#6b7280" />
              <span className="action-btn-text">Customize Report Columns</span>
              <span
                style={{
                  background: '#eff6ff',
                  color: '#2563eb',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  fontSize: '11px',
                  fontWeight: 600,
                }}
              >
                {visibleColumns.length}
              </span>
            </button>
          </div>

          {/* Report Header Text */}
          <div style={{ textAlign: 'center', padding: '56px 16px 32px' }}>
            <div
              style={{
                fontSize: '13px',
                color: '#6b7280',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '8px',
                fontWeight: 500,
              }}
            >
              {organizationName}
            </div>
            <h2
              style={{ fontSize: '18px', fontWeight: 600, color: '#111827', margin: '0 0 8px 0' }}
            >
              Job Order Report (Ledger View)
            </h2>
            <div style={{ fontSize: '13px', color: '#4b5563' }}>
              From {format(applied.fromDate, 'dd-MM-yyyy')} To{' '}
              {format(applied.toDate, 'dd-MM-yyyy')}
            </div>
          </div>

          {/* Data Table */}
          <div className="responsive-table-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1000px' }}>
              <thead>
                <tr style={{ borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
                  {visibleColumns.map((key) => (
                    <SortableHeader
                      key={key}
                      label={COLUMN_CATALOG.find((col) => col.key === key)?.label}
                      sortKey={key}
                      currentSortField={sortField as string}
                      currentSortDirection={sortDirection}
                      onSort={handleSort}
                      style={thStyle}
                      align={RIGHT_ALIGNED.has(key) ? 'right' : 'left'}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading || isError || sortedRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={visibleColumns.length}
                      style={{ ...tdStyle, textAlign: 'center', color: '#6b7280' }}
                    >
                      {isLoading
                        ? 'Loading...'
                        : isError
                          ? 'Could not load the report.'
                          : 'No job orders found'}
                    </td>
                  </tr>
                ) : (
                  sortedRows.flatMap((row) => {
                    const rowSpanCount = Math.max(1, row.process.length);
                    return Array.from({ length: rowSpanCount }).map((_, rowIndex) => (
                      <tr key={`${row.id}-${rowIndex}`} className="table-row-hover">
                        {visibleColumns.map((key) => {
                          const isGroupedColumn = !['process', 'doneBy', 'processorName'].includes(
                            key,
                          );

                          if (isGroupedColumn && rowIndex > 0) {
                            return null;
                          }

                          return (
                            <td
                              key={key}
                              rowSpan={isGroupedColumn ? rowSpanCount : 1}
                              style={{
                                ...tdStyle,
                                ...(RIGHT_ALIGNED.has(key)
                                  ? { textAlign: 'right', fontWeight: 600 }
                                  : {}),
                              }}
                            >
                              {cell(row, key, rowIndex)}
                            </td>
                          );
                        })}
                      </tr>
                    ));
                  })
                )}
              </tbody>
            </table>
          </div>

          <Pagination
            pageContext={{
              page: data?.page || page,
              perPage: data?.pageSize || perPage,
              hasMore: data ? data.page * data.pageSize < data.totalCount : false,
            }}
            total={total}
            page={page}
            perPage={perPage}
            onPageChange={setPage}
            onPerPageChange={setPerPage}
            onRequestCount={() => {}}
          />
        </div>
      </div>

      {showColumnsModal && (
        <CustomizeColumnsModal
          isOpen={showColumnsModal}
          onClose={() => setShowColumnsModal(false)}
          catalog={COLUMN_CATALOG}
          visible={visibleColumns}
          onSave={(next) => {
            setVisibleColumns(next);
            setShowColumnsModal(false);
          }}
        />
      )}
    </div>
  );
}

const thStyle = {
  padding: '10px 15px',
  textAlign: 'left' as const,
  fontSize: '11px',
  fontWeight: 600,
  color: '#333333',
  textTransform: 'uppercase' as const,
  background: '#fafafa',
  letterSpacing: '0.3px',
  border: '1px solid #eeeeee',
};

const tdStyle = {
  padding: '12px 15px',
  fontSize: '13px',
  color: '#222222',
  border: '1px solid #eeeeee',
  verticalAlign: 'top' as const,
};
