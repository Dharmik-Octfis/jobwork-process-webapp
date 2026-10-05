import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Columns, Filter, X } from 'lucide-react';
import { AdvancedFilter } from '../../components/ui/AdvancedFilter/AdvancedFilter';
import type { FilterField, FilterCondition } from '../../components/ui/AdvancedFilter/filterUtils';
import { CustomizeColumnsModal } from '../../components/ui/CustomizeColumnsModal';
import { Pagination } from '../../components/ui/Pagination';
import { useListSearch } from '../../hooks/useListSearch';
import { useOrganizationName } from '../../hooks/useOrganizationName';
import { useRecordReportVisit } from './useRecordReportVisit';
import { reportsApi, type CustomersReportQuery, type CustomersReportRow } from './reports.api';
import { useActiveCustomFields } from '../custom-fields/customFields.api';

const COLUMN_CATALOG = [
  { key: 'contactName', label: 'DISPLAY NAME', defaultVisible: true },
  { key: 'companyName', label: 'COMPANY NAME', defaultVisible: true },
  { key: 'primaryContact', label: 'PRIMARY CONTACT', defaultVisible: true },
  { key: 'email', label: 'EMAIL', defaultVisible: true },
  { key: 'contactNumber', label: 'CUSTOMER#', locked: true, defaultVisible: true },
  { key: 'customerType', label: 'BUSINESS TYPE', defaultVisible: true },
  { key: 'phone', label: 'PHONE', defaultVisible: true },
  { key: 'currency', label: 'CURRENCY', defaultVisible: true },
  { key: 'paymentTerms', label: 'PAYMENT TERMS', defaultVisible: true },
  { key: 'notes', label: 'REMARKS', defaultVisible: true },
];
const RIGHT_ALIGNED = new Set<string>([]);

interface Applied {
  conditions: FilterCondition[];
}

export function CustomersReportPage() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const organizationName = useOrganizationName();
  useRecordReportVisit(orgId, 'customer_report');

  const storageKey = `customersReportState_${orgId}`;
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
  const [applied, setApplied] = useState<Applied>(initialState?.applied ?? { conditions: [] });

  useEffect(() => {
    if (!orgId) return;
    sessionStorage.setItem(storageKey, JSON.stringify({ conditions, applied }));
  }, [orgId, storageKey, conditions, applied]);

  const [showColumnsModal, setShowColumnsModal] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() =>
    COLUMN_CATALOG.filter((col) => col.defaultVisible).map((col) => col.key)
  );

  const { data: customFields = [] } = useActiveCustomFields(orgId, 'customer');

  const customColumns = useMemo(() => {
    return customFields.map((cf) => ({
      key: `cf_${cf.key}`,
      label: cf.label.toUpperCase(),
      defaultVisible: false,
    }));
  }, [customFields]);

  const allColumns = useMemo(() => {
    return [...COLUMN_CATALOG, ...customColumns];
  }, [customColumns]);

  const [prevCustomColumns, setPrevCustomColumns] = useState(customColumns);
  if (customColumns.length > 0 && customColumns !== prevCustomColumns) {
    setPrevCustomColumns(customColumns);
    const newCols = customColumns.filter(c => c.defaultVisible).map(c => c.key).filter(k => !visibleColumns.includes(k));
    if (newCols.length > 0) {
      setVisibleColumns([...visibleColumns, ...newCols]);
    }
  }

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
    return [
      { key: 'contactNumber', label: 'Customer#', dataType: 'string', group: 'Report' },
      { key: 'companyName', label: 'Company Name', dataType: 'string', group: 'Report' },
      { key: 'contactName', label: 'Display Name', dataType: 'string', group: 'Report' },
      { key: 'primaryContact', label: 'Primary Contact', dataType: 'string', group: 'Report' },
      { key: 'email', label: 'Email', dataType: 'string', group: 'Report' },
      { key: 'phone', label: 'Phone', dataType: 'string', group: 'Report' },
      ...customFilterFields,
    ];
  }, [customFilterFields]);

  const { page, setPage, perPage, setPerPage } = useListSearch();

  const query = useMemo<CustomersReportQuery>(() => {
    const valueOf = (field: string) => {
      const value = applied.conditions.find((c) => c.field === field)?.value;
      return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    };

    const q: CustomersReportQuery = {
      page,
      perPage,
      contactNumber: valueOf('contactNumber'),
      companyName: valueOf('companyName'),
    };

    return q;
  }, [applied, page, perPage]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', 'customers', orgId, query],
    queryFn: () => reportsApi.getCustomersReport(orgId!, query),
    enabled: Boolean(orgId),
    staleTime: 60 * 1000,
  });

  const rows = useMemo(() => data?.items || [], [data?.items]);
  const total = data?.pagination.totalCount || 0;

  const cell = (row: CustomersReportRow, key: string) => {
    if (key === 'contactNumber') {
      return (
        <Link
          to={`/organizations/${orgId}/sales/customers?id=${row.id}`}
          className="text-blue-600 hover:underline"
          style={{ color: '#0062ff' }}
        >
          {row[key as keyof CustomersReportRow] as string}
        </Link>
      );
    }
    if (key.startsWith('cf_')) {
      const cfKey = key.replace('cf_', '');
      const val = (row.customFields as Record<string, unknown>)?.[cfKey];
      if (val === null || val === undefined || val === '') return '-';
      return String(val);
    }

    const val = row[key as keyof CustomersReportRow];
    if (val === null || val === undefined || val === '') return '-';
    return String(val);
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
          <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '2px' }}>Sales</div>
          <div style={{ fontSize: '16px', fontWeight: 500, color: '#111827' }}>
            Customer Report
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
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#111827', margin: '0 0 8px 0' }}>
              Customer Report
            </h2>
          </div>

          <div className="responsive-table-wrapper" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1000px' }}>
              <thead>
                <tr style={{ borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
                  {visibleColumns.map((key) => (
                    <th key={key} style={{ ...thStyle, textAlign: RIGHT_ALIGNED.has(key) ? 'right' : 'left' }}>
                      {allColumns.find((col) => col.key === key)?.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading || isError || rows.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumns.length} style={{ ...tdStyle, textAlign: 'center', color: '#6b7280' }}>
                      {isLoading ? 'Loading...' : isError ? 'Could not load the report.' : 'No customers found'}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="table-row-hover">
                      {visibleColumns.map((key) => (
                        <td
                          key={key}
                          style={{
                            ...tdStyle,
                            ...(RIGHT_ALIGNED.has(key) ? { textAlign: 'right', fontWeight: 600 } : {}),
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
              page: data?.pagination.page || page,
              perPage: data?.pagination.pageSize || perPage,
              hasMore: data ? data.pagination.page * data.pagination.pageSize < data.pagination.totalCount : false,
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
          catalog={allColumns}
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
  whiteSpace: 'nowrap' as const,
};

const tdStyle = {
  padding: '12px 15px',
  fontSize: '13px',
  color: '#222222',
  border: '1px solid #eeeeee',
  verticalAlign: 'top' as const,
  whiteSpace: 'nowrap' as const,
};
