import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X, Filter, Columns } from 'lucide-react';
import { format } from 'date-fns';
import { AdvancedFilter } from '../../components/ui/AdvancedFilter/AdvancedFilter';
import type { FilterField, FilterCondition } from '../../components/ui/AdvancedFilter/filterUtils';
import { CustomizeColumnsModal } from '../../components/ui/CustomizeColumnsModal';
import { Pagination } from '../../components/ui/Pagination';
import { useListSearch } from '../../hooks/useListSearch';
import { useOrganizationName } from '../../hooks/useOrganizationName';
import { useRecordReportVisit } from './useRecordReportVisit';
import { reportsApi, type JobOrdersReportQuery, type JobOrdersReportRow } from './reports.api';

const COLUMN_CATALOG = [
  { key: 'jobOrderNumber', label: 'JOB ORDER#', locked: true, defaultVisible: true },
  { key: 'orderDate', label: 'DATE', locked: true, defaultVisible: true },
  { key: 'status', label: 'STATUS', defaultVisible: true },
  { key: 'process', label: 'PROCESS', defaultVisible: true },
  { key: 'processorName', label: 'PROCESSOR', defaultVisible: true },
  { key: 'totalIssued', label: 'TOTAL ISSUED', defaultVisible: true },
  { key: 'totalReceived', label: 'TOTAL RECEIVED', defaultVisible: true },
];

const RIGHT_ALIGNED = new Set(['totalIssued', 'totalReceived']);

interface Applied {
  conditions: FilterCondition[];
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
      return {
        conditions: (parsed.conditions as FilterCondition[]) || [],
        applied: {
          conditions: (parsed.applied?.conditions as FilterCondition[]) || [],
        } satisfies Applied,
      };
    } catch {
      return null;
    }
  }, [orgId, storageKey]);

  const [conditions, setConditions] = useState<FilterCondition[]>(initialState?.conditions ?? []);
  const [applied, setApplied] = useState<Applied>(
    initialState?.applied ?? { conditions: [] },
  );

  useEffect(() => {
    if (!orgId) return;
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ conditions, applied }),
    );
  }, [orgId, storageKey, conditions, applied]);

  const [showColumnsModal, setShowColumnsModal] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    COLUMN_CATALOG.filter((col) => col.defaultVisible).map((col) => col.key),
  );

  const filterFields = useMemo<FilterField[]>(
    () => [
      { key: 'jobOrderNumber', label: 'Job Order#', dataType: 'string', group: 'Report' },
      { key: 'processorName', label: 'Processor', dataType: 'string', group: 'Report' },
      { key: 'processName', label: 'Process', dataType: 'string', group: 'Report' },
    ],
    [],
  );

  const { page, setPage, perPage, setPerPage } = useListSearch();

  const query = useMemo<JobOrdersReportQuery>(() => {
    const valueOf = (field: string) => {
      const value = applied.conditions.find((c) => c.field === field)?.value;
      return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    };
    return {
      jobOrderNumber: valueOf('jobOrderNumber'),
      processorName: valueOf('processorName'),
      processName: valueOf('processName'),
      page,
      perPage,
    };
  }, [applied, page, perPage]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', orgId, 'job-orders', query],
    queryFn: () => reportsApi.getJobOrdersReport(orgId!, query),
    enabled: Boolean(orgId),
  });

  const rows = data?.results ?? [];
  const total = data?.totalCount ?? 0;

  const cell = (row: JobOrdersReportRow, key: string) => {
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
      case 'status':
        return row.status;
      case 'process':
        return row.process || '-';
      case 'processorName':
        return row.processorName || '-';
      case 'totalIssued':
        return row.totalIssued.toFixed(2);
      case 'totalReceived':
        return row.totalReceived.toFixed(2);
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
        fontFamily: 'Inter, system-ui, sans-serif',
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
              setApplied({ conditions });
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
              Job Order Report (Ledger View)
            </h2>
          </div>

          {/* Data Table */}
          <div className="responsive-table-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1000px' }}>
              <thead>
                <tr style={{ borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
                  {visibleColumns.map((key) => (
                    <th
                      key={key}
                      style={{ ...thStyle, textAlign: RIGHT_ALIGNED.has(key) ? 'right' : 'left' }}
                    >
                      {COLUMN_CATALOG.find((col) => col.key === key)?.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading || isError || rows.length === 0 ? (
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
                  rows.map((row) => (
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
                          }}
                        >
                          {cell(row, key)}
                        </td>
                      ))}
                    </tr>
                  ))
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
