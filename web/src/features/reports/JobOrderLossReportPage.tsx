import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X, Filter, Columns } from 'lucide-react';
import { format, startOfMonth } from 'date-fns';
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
import { reportsApi, type JobOrderLossQuery, type JobOrderLossRow } from './reports.api';
import { useTableSort } from '../../hooks/useTableSort';
import { SortableHeader } from '../../components/ui/SortableHeader';

/**
 * Every write-off a completed or short-closed job order step made — what the
 * accountant books as abnormal loss, raises a debit note for, and reverses input
 * tax credit on. The rows are the `scrap` postings `writeOffStep` already made.
 */

const COLUMN_CATALOG = [
  { key: 'writtenOffAt', label: 'DATE', locked: true, defaultVisible: true },
  { key: 'jobOrderNumber', label: 'JOB ORDER#', locked: true, defaultVisible: true },
  { key: 'step', label: 'STEP', defaultVisible: true },
  { key: 'challanNumber', label: 'CHALLAN#', defaultVisible: true },
  { key: 'processorName', label: 'PROCESSOR', defaultVisible: true },
  { key: 'itemName', label: 'ITEM NAME', locked: true, defaultVisible: true },
  { key: 'batchNumber', label: 'BATCH', defaultVisible: false },
  { key: 'closedAs', label: 'CLOSED AS', defaultVisible: false },
  { key: 'qty', label: 'QUANTITY', locked: true, defaultVisible: true },
  { key: 'value', label: 'LOSS VALUE', locked: true, defaultVisible: true },
  { key: 'reason', label: 'REASON', defaultVisible: true },
];

const RIGHT_ALIGNED = new Set(['qty', 'value']);

const money = (value: number) =>
  `₹${value < 0 ? '-' : ''}${Math.abs(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const firstOfMonth = () => startOfMonth(new Date());

interface Applied {
  fromDate: Date;
  toDate: Date;
  conditions: FilterCondition[];
}

export function JobOrderLossReportPage() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const organizationName = useOrganizationName();
  useRecordReportVisit(orgId, 'job_order_loss');

  const storageKey = `jobOrderLossState_${orgId}`;
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
      { key: 'jobOrderNumber', label: 'Job Order#', dataType: 'string', group: 'Report' },
    ],
    [orgId],
  );

  const { page, setPage, perPage, setPerPage } = useListSearch();

  const query = useMemo<JobOrderLossQuery>(() => {
    const valueOf = (field: string) => {
      const value = applied.conditions.find((c) => c.field === field)?.value;
      return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    };
    return {
      fromDate: format(applied.fromDate, 'yyyy-MM-dd'),
      toDate: format(applied.toDate, 'yyyy-MM-dd'),
      itemName: valueOf('itemName'),
      processorName: valueOf('processorName'),
      jobOrderNumber: valueOf('jobOrderNumber'),
      page,
      perPage,
    };
  }, [applied, page, perPage]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', orgId, 'job-order-loss', query],
    queryFn: () => reportsApi.getJobOrderLoss(orgId!, query),
    enabled: Boolean(orgId),
  });

  const rows = data?.results ?? [];
  const { sortedRows, sortField, sortDirection, handleSort } = useTableSort(rows);
  const total = data?.total ?? 0;
  const formattedFromDate = format(applied.fromDate, 'dd-MM-yyyy');
  const formattedToDate = format(applied.toDate, 'dd-MM-yyyy');

  const cell = (row: JobOrderLossRow, key: string) => {
    switch (key) {
      case 'writtenOffAt':
        return format(new Date(row.writtenOffAt), 'dd-MM-yyyy');
      case 'jobOrderNumber':
        return (
          <Link
            className="hover-underline"
            to={`/organizations/${orgId}/jobwork/job-orders/${row.jobOrderId}`}
            style={{ color: '#0062ff', fontWeight: 500 }}
          >
            {row.jobOrderNumber}
          </Link>
        );
      case 'step':
        return `${row.stepSeq}. ${row.processName}`;
      case 'challanNumber':
        return row.jobIssueId && row.challanNumber ? (
          <Link
            className="hover-underline"
            to={`/organizations/${orgId}/jobwork/issues?id=${row.jobIssueId}`}
            style={{ color: '#0062ff' }}
          >
            {row.challanNumber}
          </Link>
        ) : (
          '-'
        );
      case 'processorName':
        return row.processorName || '-';
      case 'itemName':
        return (
          <>
            <Link
              className="hover-underline"
              to={`/organizations/${orgId}/items?id=${row.itemId}`}
              style={{ color: '#0062ff', fontWeight: 500 }}
            >
              {row.itemName}
            </Link>{' '}
            <span style={{ color: '#9ca3af', fontSize: '12px' }}>({row.uomName || 'unit'})</span>
          </>
        );
      case 'batchNumber':
        return row.batchNumber || '-';
      case 'closedAs':
        return row.closedAs === 'short_closed' ? 'Closed short' : 'Step completed';
      case 'qty':
        return row.qty.toFixed(2);
      case 'value':
        return money(row.value);
      case 'reason':
        return row.reason || '-';
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
            Job Order Loss Report
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
              Job Order Loss Report
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
                          : 'No write-offs in this period'}
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((row) => (
                    <tr
                      key={row.id}
                      className="table-row-hover"
                      style={{ borderTop: '1px solid #f9fafb' }}
                    >
                      {visibleColumns.map((key) => (
                        <td
                          key={key}
                          style={{
                            ...tdStyle,
                            ...(RIGHT_ALIGNED.has(key)
                              ? { textAlign: 'right', fontWeight: 600 }
                              : {}),
                            ...(key === 'reason'
                              ? { maxWidth: '280px', whiteSpace: 'normal' }
                              : {}),
                          }}
                        >
                          {cell(row, key)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
                {rows.length > 0 && (
                  <tr style={{ borderTop: '1px solid #e5e7eb' }}>
                    {visibleColumns.map((key, index) => (
                      <td
                        key={key}
                        style={{
                          ...tdStyle,
                          fontWeight: index === 0 ? 600 : 700,
                          textAlign: key === 'value' ? 'right' : 'left',
                        }}
                      >
                        {index === 0
                          ? 'Total'
                          : key === 'value'
                            ? money(data?.grandTotalValue ?? 0)
                            : null}
                      </td>
                    ))}
                  </tr>
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
};

const tdStyle = {
  padding: '12px 24px',
  fontSize: '13px',
  color: '#111827',
  borderBottom: '1px solid #f3f4f6',
};
