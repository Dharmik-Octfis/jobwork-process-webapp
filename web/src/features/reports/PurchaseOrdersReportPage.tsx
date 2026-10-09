import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Columns, Filter, X } from 'lucide-react';
import { format, startOfMonth } from 'date-fns';
import { formatDate } from '../../lib/formatDate';
import { AdvancedFilter } from '../../components/ui/AdvancedFilter/AdvancedFilter';
import type { FilterField, FilterCondition } from '../../components/ui/AdvancedFilter/filterUtils';
import { CustomizeColumnsModal } from '../../components/ui/CustomizeColumnsModal';
import { Pagination } from '../../components/ui/Pagination';
import { ReportDateFilter } from './components/ReportDateFilter';
import { useListSearch } from '../../hooks/useListSearch';
import { useOrganizationName } from '../../hooks/useOrganizationName';
import { useRecordReportVisit } from './useRecordReportVisit';
import { reportsApi, type PurchaseOrdersReportQuery, type PurchaseOrdersReportRow } from './reports.api';
import { useActiveCustomFields } from '../custom-fields/customFields.api';
import { fetchPaymentTerms } from '../purchases/purchase-orders/payment-terms.api';
import { fetchVendors } from '../purchases/vendors/vendors.api';
import { useTableSort } from '../../hooks/useTableSort';
import { SortableHeader } from '../../components/ui/SortableHeader';
import { ReportExportMenu } from './components/ReportExportMenu';

const COLUMN_CATALOG = [
  { key: 'poNumber', label: 'PO NUMBER', locked: true, defaultVisible: true },
  { key: 'vendorName', label: 'VENDOR NAME', defaultVisible: true },
  { key: 'locationName', label: 'LOCATION', defaultVisible: true },
  { key: 'deliveryAddress', label: 'DELIVERY ADDRESS', defaultVisible: true },
  { key: 'date', label: 'DATE', defaultVisible: true },
  { key: 'deliveryDate', label: 'DELIVERY DATE', defaultVisible: true },
  { key: 'paymentTerms', label: 'PAYMENT TERMS', defaultVisible: true },
  { key: 'total', label: 'TOTAL', defaultVisible: true },
  { key: 'status', label: 'STATUS', defaultVisible: true },
  { key: 'deliveryType', label: 'DELIVERY TYPE', defaultVisible: false },
];

const RIGHT_ALIGNED = new Set<string>(['total']);

interface Applied {
  conditions: FilterCondition[];
  fromDate: Date;
  toDate: Date;
}

export function PurchaseOrdersReportPage() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const organizationName = useOrganizationName();
  useRecordReportVisit(orgId, 'purchase_order_report');

  const storageKey = `PurchaseOrdersReportState_${orgId}`;
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
  const [fromDate, setFromDate] = useState<Date>(initialState?.fromDate || startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date>(initialState?.toDate || new Date());
  const [conditions, setConditions] = useState<FilterCondition[]>(initialState?.conditions ?? []);
  const [applied, setApplied] = useState<Applied>(initialState?.applied ?? { conditions: [], fromDate: startOfMonth(new Date()), toDate: new Date() });

  useEffect(() => {
    if (!orgId) return;
    sessionStorage.setItem(storageKey, JSON.stringify({ dateRange, fromDate, toDate, conditions, applied }));
  }, [orgId, storageKey, dateRange, fromDate, toDate, conditions, applied]);

  const [showColumnsModal, setShowColumnsModal] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() =>
    COLUMN_CATALOG.filter((col) => col.defaultVisible).map((col) => col.key)
  );

  const { data: customFields = [] } = useActiveCustomFields(orgId, 'purchase_order');

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

  const { data: vendorsPage } = useQuery({
    queryKey: ['vendors', orgId],
    queryFn: () => fetchVendors(orgId!, { perPage: 500 }),
    enabled: Boolean(orgId),
  });
  const vendors = useMemo(() => vendorsPage?.results || [], [vendorsPage?.results]);

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
    const vendorOptions = vendors
      .map((v) => {
        const name = v.companyName || v.contactName;
        return name ? { label: name, value: name } : null;
      })
      .filter((opt): opt is { label: string; value: string } => opt !== null);
    const statusOptions = [
      { label: 'Draft', value: 'Draft' },
      { label: 'Pending Approval', value: 'Pending Approval' },
      { label: 'Approved', value: 'Approved' },
      { label: 'Active', value: 'Active' },
      { label: 'Rejected', value: 'Rejected' },
      { label: 'Billed', value: 'Billed' },
    ];
    const deliveryTypeOptions = [
      { label: 'Location', value: 'Location' },
      { label: 'Customer', value: 'Customer' },
    ];

    return [
      { key: 'poNumber', label: 'PO Number', dataType: 'string', group: 'Report' },
      { key: 'vendorName', label: 'Vendor Name', dataType: 'select', options: vendorOptions, group: 'Report' },
      { key: 'status', label: 'Status', dataType: 'select', options: statusOptions, group: 'Report' },
      { key: 'deliveryType', label: 'Delivery Type', dataType: 'select', options: deliveryTypeOptions, group: 'Report' },
      ...customFilterFields,
    ];
  }, [customFilterFields, vendors]);

  const { page, setPage, perPage, setPerPage } = useListSearch();

  const query = useMemo<PurchaseOrdersReportQuery>(() => {
    const valueOf = (field: string) => {
      const value = applied.conditions.find((c) => c.field === field)?.value;
      return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    };

    const q: PurchaseOrdersReportQuery = {
      page,
      perPage,
      status: valueOf('status'),
      deliveryType: valueOf('deliveryType'),
      poNumber: valueOf('poNumber'),
      vendorName: valueOf('vendorName'),
      fromDate: format(applied.fromDate, 'yyyy-MM-dd'),
      toDate: format(applied.toDate, 'yyyy-MM-dd'),
    };

    // Process custom fields
    const customFields: Record<string, unknown> = {};
    applied.conditions.forEach((c) => {
      if (c.field.startsWith('cf_') && c.value !== undefined && c.value !== null && c.value !== '') {
        const key = c.field.replace('cf_', '');
        customFields[key] = c.value;
      }
    });
    if (Object.keys(customFields).length > 0) {
      q.purchaseOrderCustomFields = customFields;
    }

    return q;
  }, [applied, page, perPage]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', 'purchaseOrders', orgId, query],
    queryFn: () => reportsApi.getPurchaseOrdersReport(orgId!, query),
    enabled: Boolean(orgId),
  });

  const { data: paymentTermsData = [] } = useQuery({
    queryKey: ['paymentTerms', orgId],
    queryFn: () => fetchPaymentTerms(orgId!),
    enabled: Boolean(orgId),
  });

  const rows = useMemo(() => data?.items || [], [data?.items]);
  const { sortedRows, sortField, sortDirection, handleSort } = useTableSort(rows);
  const total = data?.pagination.totalCount || 0;

  const cell = (row: PurchaseOrdersReportRow, key: string) => {
    if (key === 'poNumber') {
      return (
        <Link
          to={`/organizations/${orgId}/purchases/purchase-orders?id=${row.id}`}
          className="text-blue-600 hover:underline"
          style={{ color: '#0062ff' }}
        >
          {row[key as keyof PurchaseOrdersReportRow] as string}
        </Link>
      );
    }

    if (key === 'vendorName') {
      return (
        <Link
          to={`/organizations/${orgId}/purchases/vendors?id=${row.vendorId}`}
          className="text-blue-600 hover:underline"
          style={{ color: '#0062ff' }}
        >
          {row.vendorName || '-'}
        </Link>
      );
    }

    if (key.startsWith('cf_')) {
      const cfKey = key.replace('cf_', '');
      const val = (row.customFields as Record<string, unknown>)?.[cfKey];
      if (val === null || val === undefined || val === '') return '-';
      return String(val);
    }

    if (key === 'paymentTerms') {
      const termVal = row.paymentTerms;
      if (!termVal || termVal === '-') return '-';
      const term = paymentTermsData.find((t) => t.id === termVal || t.termName === termVal);
      return term ? term.termName : termVal;
    }

    if (key === 'total') {
      return `₹${Number(row.total || 0).toFixed(2)}`;
    }
    if (key === 'date' || key === 'deliveryDate') {
      const val = row[key as keyof PurchaseOrdersReportRow];
      return val ? formatDate(val as string) : '-';
    }

    const val = row[key as keyof PurchaseOrdersReportRow];
    if (val === null || val === undefined || val === '') return '-';
    return String(val);
  };

  const exportColumns = useMemo(() => {
    return visibleColumns.map((colKey) => {
      const standardCol = COLUMN_CATALOG.find((c) => c.key === colKey);
      if (standardCol) {
        return {
          key: standardCol.key,
          label: standardCol.label,
          align: (RIGHT_ALIGNED.has(standardCol.key) ? 'right' : 'left') as 'right' | 'left',
        };
      }
      const customCol = customColumns.find((c) => c.key === colKey);
      return {
        key: colKey,
        label: customCol ? customCol.label : colKey.toUpperCase(),
        align: 'left' as const,
      };
    });
  }, [visibleColumns, customColumns]);

  const exportRows = useMemo(() => {
    return sortedRows.map((row) =>
      exportColumns.map((col) => {
        if (col.key.startsWith('cf_')) {
          const cfKey = col.key.replace('cf_', '');
          const val = row.customFields?.[cfKey];
          return val !== undefined && val !== null && val !== '' ? String(val) : '-';
        }
        if (col.key === 'paymentTerms') {
          const termVal = row.paymentTerms;
          if (!termVal || termVal === '-') return '-';
          const term = paymentTermsData.find((t) => t.id === termVal || t.termName === termVal);
          return term ? term.termName : termVal;
        }
        if (col.key === 'total') {
          return Number(row.total || 0).toFixed(2);
        }
        if (col.key === 'date' || col.key === 'deliveryDate') {
          const val = row[col.key as keyof PurchaseOrdersReportRow];
          return val ? formatDate(val as string) : '-';
        }
        const val = row[col.key as keyof PurchaseOrdersReportRow];
        return val !== null && val !== undefined && val !== '' ? String(val) : '-';
      })
    );
  }, [sortedRows, exportColumns, paymentTermsData]);

  const totalPOAmount = useMemo(() => rows.reduce((sum, r) => sum + (Number(r.total) || 0), 0), [rows]);

  const exportTotalRow = useMemo(() => {
    return exportColumns.map((col, idx) => {
      if (idx === 0) return 'TOTAL';
      if (col.key === 'total') return Number(totalPOAmount || 0).toFixed(2);
      return '';
    });
  }, [exportColumns, totalPOAmount]);

  const fetchExportData = async () => {
    if (!orgId) return { data: [] };
    const allRes = await reportsApi.getPurchaseOrdersReport(orgId, {
      ...query,
      page: undefined,
      perPage: undefined,
    });
    const allRows = allRes?.items || [];
    const allExportRows = allRows.map((row) =>
      exportColumns.map((col) => {
        if (col.key.startsWith('cf_')) {
          const cfKey = col.key.replace('cf_', '');
          const val = row.customFields?.[cfKey];
          return val !== undefined && val !== null && val !== '' ? String(val) : '-';
        }
        if (col.key === 'paymentTerms') {
          const termVal = row.paymentTerms;
          if (!termVal || termVal === '-') return '-';
          const term = paymentTermsData.find((t) => t.id === termVal || t.termName === termVal);
          return term ? term.termName : termVal;
        }
        if (col.key === 'total') {
          return Number(row.total || 0).toFixed(2);
        }
        if (col.key === 'date' || col.key === 'deliveryDate') {
          const val = row[col.key as keyof PurchaseOrdersReportRow];
          return val ? formatDate(val as string) : '-';
        }
        const val = row[col.key as keyof PurchaseOrdersReportRow];
        return val !== null && val !== undefined && val !== '' ? String(val) : '-';
      })
    );
    const allTotalPOAmount = allRows.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
    const allTotalRow = exportColumns.map((col, idx) => {
      if (idx === 0) return 'TOTAL';
      if (col.key === 'total') return Number(allTotalPOAmount || 0).toFixed(2);
      return '';
    });
    return { data: allExportRows, totalRow: allTotalRow };
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
          <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '2px' }}>Purchases</div>
          <div style={{ fontSize: '16px', fontWeight: 500, color: '#111827' }}>
            Purchase Order Report
            <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: '6px' }}>
              • From {format(applied.fromDate, 'dd-MM-yyyy')} To {format(applied.toDate, 'dd-MM-yyyy')}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ReportExportMenu
            orgName={organizationName || 'OCTFIS TECHNO LLP'}
            reportTitle="Purchase Order Report"
            dateSubtitle={`From ${format(applied.fromDate, 'dd-MM-yyyy')} To ${format(applied.toDate, 'dd-MM-yyyy')}`}
            columns={exportColumns}
            data={exportRows}
            totalRow={exportTotalRow}
            fetchExportData={fetchExportData}
            footnote="**Amount is displayed in your base currency INR"
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
              Purchase Order Report
            </h2>
            <div style={{ fontSize: '13px', color: '#4b5563' }}>
              From {format(applied.fromDate, 'dd-MM-yyyy')} To {format(applied.toDate, 'dd-MM-yyyy')}
            </div>
          </div>

          <div className="responsive-table-wrapper" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1000px' }}>
              <thead>
                <tr style={{ borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
                  {visibleColumns.map((key) => (
                    <SortableHeader
                      key={key}
                      label={allColumns.find((col) => col.key === key)?.label}
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
                    <td colSpan={visibleColumns.length} style={{ ...tdStyle, textAlign: 'center', color: '#6b7280' }}>
                      {isLoading ? 'Loading...' : isError ? 'Could not load the report.' : 'No Purchase Orders found'}
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((row) => (
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
