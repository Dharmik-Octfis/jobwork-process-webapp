import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X, Filter, Columns } from 'lucide-react';
import { format, endOfDay, startOfMonth } from 'date-fns';
import { AdvancedFilter } from '../../components/ui/AdvancedFilter/AdvancedFilter';
import type { FilterField, FilterCondition } from '../../components/ui/AdvancedFilter/filterUtils';
import { CustomizeColumnsModal } from '../../components/ui/CustomizeColumnsModal';
import { Pagination } from '../../components/ui/Pagination';
import { ItemComboBox } from '../../components/ui/ItemComboBox';
import { useListSearch } from '../../hooks/useListSearch';
import { useOrganizationName } from '../../hooks/useOrganizationName';
import type { Item } from '../items/items.schemas';
import { ReportDateFilter } from './components/ReportDateFilter';
import { useRecordReportVisit } from './useRecordReportVisit';
import { reportsApi, type JobworkReceiptsQuery, type JobworkReceiptRow } from './reports.api';
import { RECEIPT_STATUS_META } from '../jobwork/jobwork.schemas';
import { useTableSort } from '../../hooks/useTableSort';
import { SortableHeader } from '../../components/ui/SortableHeader';

const COLUMN_CATALOG = [
  { key: 'receiptDate', label: 'DATE', locked: true, defaultVisible: true },
  { key: 'receiptNumber', label: 'RECEIPT#', locked: true, defaultVisible: true },
  { key: 'processorName', label: 'PROCESSOR', defaultVisible: true },
  { key: 'process', label: 'PROCESS', defaultVisible: true },
  { key: 'jobOrderNumber', label: 'JOB ORDER#', defaultVisible: true },
  { key: 'items', label: 'ITEMS', defaultVisible: true },
  { key: 'plannedQty', label: 'PLANNED QTY', defaultVisible: true },
  { key: 'receivedQty', label: 'RECEIVE QTY', defaultVisible: true },
  { key: 'toBeReceivedQty', label: 'TO BE RECEIVED QTY', defaultVisible: true },
  { key: 'status', label: 'STATUS', defaultVisible: true },
];

const RIGHT_ALIGNED = new Set(['plannedQty', 'receivedQty', 'toBeReceivedQty']);

const firstOfMonth = () => startOfMonth(new Date());

interface Applied {
  fromDate: Date;
  toDate: Date;
  conditions: FilterCondition[];
}

export function JobworkReceiptsRegisterPage() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const organizationName = useOrganizationName();
  useRecordReportVisit(orgId, 'jobwork_receipt_report');

  const storageKey = `jobworkReceiptsState_${orgId}`;
  const initialState = useMemo(() => {
    try {
      const stored = orgId ? sessionStorage.getItem(storageKey) : null;
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      const safeDate = (val: unknown, fallback: Date) => {
        const d = new Date(val as string);
        return val && !isNaN(d.getTime()) ? d : fallback;
      };
      return {
        dateRange: (parsed.dateRange as string) || 'This Month',
        fromDate: safeDate(parsed.fromDate, firstOfMonth()),
        toDate: safeDate(parsed.toDate, new Date()),
        conditions: (parsed.conditions as FilterCondition[]) || [],
        applied: {
          fromDate: safeDate(parsed.applied?.fromDate, firstOfMonth()),
          toDate: safeDate(parsed.applied?.toDate, new Date()),
          conditions: (parsed.applied?.conditions as FilterCondition[]) || [],
        } satisfies Applied,
      };
    } catch {
      return null;
    }
  }, [orgId, storageKey]);

  const [dateRange, setDateRange] = useState(initialState?.dateRange ?? 'This Month');
  const [fromDate, setFromDate] = useState<Date>(initialState?.fromDate ?? firstOfMonth());
  const [toDate, setToDate] = useState<Date>(initialState?.toDate ?? new Date());
  const [conditions, setConditions] = useState<FilterCondition[]>(initialState?.conditions ?? []);
  const [applied, setApplied] = useState<Applied>(
    initialState?.applied ?? { fromDate: firstOfMonth(), toDate: new Date(), conditions: [] },
  );

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

  const filterFields = useMemo<FilterField[]>(
    () => [
      {
        key: 'itemName',
        label: 'Item Name',
        dataType: 'string',
        group: 'Report',
        renderInput: ({ value, onChange }) => (
          <div style={{ flex: 1, minWidth: 200 }}>
            <ItemComboBox
              orgId={orgId!}
              value={(value as string) || ''}
              initialItem={
                value ? ({ id: value as string, name: value as string } as unknown as Item) : null
              }
              onChange={(item) => onChange(item?.name || '')}
              placeholder="Select an item…"
              portal
            />
          </div>
        ),
      },
      { key: 'processorName', label: 'Processor', dataType: 'string', group: 'Report' },
      { key: 'processName', label: 'Process', dataType: 'string', group: 'Report' },
      { key: 'jobOrderNumber', label: 'Job Order#', dataType: 'string', group: 'Report' },
      { key: 'receiptNumber', label: 'Receipt#', dataType: 'string', group: 'Report' },
      {
        key: 'status',
        label: 'Status',
        dataType: 'select',
        group: 'Report',
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Posted', value: 'posted' },
          { label: 'Cancelled', value: 'cancelled' },
        ],
      },
      { key: 'issuedQty', label: 'Issued Qty', dataType: 'number', group: 'Quantities' },
      { key: 'receivedQty', label: 'Received Qty', dataType: 'number', group: 'Quantities' },
      { key: 'minAgeDays', label: 'Min Age (Days)', dataType: 'number', group: 'Report' },
    ],
    [orgId],
  );

  const { page, setPage, perPage, setPerPage } = useListSearch();

  const query = useMemo<JobworkReceiptsQuery>(() => {
    const valueOf = (field: string) => {
      const value = applied.conditions.find((c) => c.field === field)?.value;
      return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    };
    const numValueOf = (field: string) => {
      const value = applied.conditions.find((c) => c.field === field)?.value;
      if (value === undefined || value === null || value === '') return undefined;
      const num = Number(value);
      return isNaN(num) ? undefined : num;
    };
    return {
      fromDate: applied.fromDate.toISOString(),
      toDate: endOfDay(applied.toDate).toISOString(),
      itemName: valueOf('itemName'),
      processorName: valueOf('processorName'),
      processName: valueOf('processName'),
      jobOrderNumber: valueOf('jobOrderNumber'),
      receiptNumber: valueOf('receiptNumber'),
      status: valueOf('status'),
      issuedQty: numValueOf('issuedQty'),
      receivedQty: numValueOf('receivedQty'),
      minAgeDays: numValueOf('minAgeDays'),
      page,
      perPage,
    };
  }, [applied, page, perPage]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', orgId, 'jobwork-receipts', query],
    queryFn: () => reportsApi.getJobworkReceipts(orgId!, query),
    enabled: Boolean(orgId),
  });

  const rows = data?.results ?? [];
  const { sortedRows, sortField, sortDirection, handleSort } = useTableSort(rows);
  const total = data?.total ?? 0;
  const formattedFromDate = format(applied.fromDate, 'dd-MM-yyyy');
  const formattedToDate = format(applied.toDate, 'dd-MM-yyyy');

  const cell = (row: JobworkReceiptRow, line: JobworkReceiptRow['lines'][number], key: string) => {
    switch (key) {
      case 'receiptDate':
        return format(new Date(row.receiptDate), 'dd-MM-yyyy');
      case 'receiptNumber':
        return (
          <Link
            className="hover-underline"
            to={`/organizations/${orgId}/jobwork/receipts?id=${row.id}`}
            style={{ color: '#0062ff', fontWeight: 500 }}
          >
            {row.receiptNumber}
          </Link>
        );
      case 'processorName':
        return row.processorName;
      case 'process':
        return row.process;
      case 'jobOrderNumber':
        return (
          <Link
            className="hover-underline"
            to={`/organizations/${orgId}/jobwork/job-orders/${row.jobOrderId}`}
            style={{ color: '#0062ff' }}
          >
            {row.jobOrderNumber}
          </Link>
        );
      case 'items':
        return (
          <Link
            to={`/organizations/${orgId}/items?id=${line.itemId}`}
            className="text-blue-600 hover:underline"
            onClick={(e) => e.stopPropagation()}
            style={{ color: '#0062ff' }}
          >
            {line.items}
          </Link>
        );
      case 'plannedQty':
        return line.plannedQty?.toFixed(2) || '0.00';
      case 'receivedQty':
        return line.receivedQty?.toFixed(2) || '0.00';
      case 'toBeReceivedQty':
        return line.toBeReceivedQty?.toFixed(2) || '0.00';
      case 'status':
        return RECEIPT_STATUS_META[row.status as keyof typeof RECEIPT_STATUS_META]?.label || row.status;
      default:
        return null;
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#f4f5f7',
        fontFamily: '"Zoho Puvi", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
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
            Jobwork Receipt Register
            <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: '6px' }}>
              • From {formattedFromDate} To {formattedToDate}
            </span>
          </div>
        </div>

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
              setFromDate(start);
              setToDate(end);
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
              setApplied({ fromDate, toDate, conditions });
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
              gap: '16px',
              alignItems: 'center',
            }}
          >
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
              Jobwork Receipt Register
            </h2>
            <div style={{ fontSize: '13px', color: '#4b5563' }}>
              From {formattedFromDate} To {formattedToDate}
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
                          : 'No receipts found'}
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((row) => (
                    <React.Fragment key={row.id}>
                      {row.lines?.map((line, lineIndex) => (
                        <tr key={line.id}>
                          {visibleColumns.map((key) => {
                            const isLineCol = ['items', 'plannedQty', 'receivedQty', 'toBeReceivedQty'].includes(key);
                            if (!isLineCol && lineIndex > 0) return null;
                            
                            return (
                              <td
                                key={key}
                                rowSpan={!isLineCol ? row.lines.length : 1}
                                style={{
                                  ...tdStyle,
                                  ...(RIGHT_ALIGNED.has(key)
                                    ? { textAlign: 'right', fontWeight: 600 }
                                    : {}),
                                }}
                              >
                                {cell(row, line, key)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <Pagination
            pageContext={{
              page: data?.page || page,
              perPage: data?.perPage || perPage,
              hasMore: data ? data.page < data.totalPages : false,
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
  padding: '12px 24px',
  fontSize: '11px',
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase' as const,
  background: '#f9fafb',
  letterSpacing: '0.5px',
  border: '1px solid #eeeeee',
  whiteSpace: 'nowrap' as const,
};

const tdStyle = {
  padding: '12px 24px',
  fontSize: '13px',
  color: '#111827',
  verticalAlign: 'top' as const,
  border: '1px solid #eeeeee',
  whiteSpace: 'nowrap' as const,
};
