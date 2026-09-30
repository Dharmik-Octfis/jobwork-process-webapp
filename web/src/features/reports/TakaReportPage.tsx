import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X, Filter, Columns } from 'lucide-react';
import { format } from 'date-fns';
import { AdvancedFilter } from '../../components/ui/AdvancedFilter/AdvancedFilter';
import type { FilterField, FilterCondition } from '../../components/ui/AdvancedFilter/filterUtils';
import { CustomizeColumnsModal } from '../../components/ui/CustomizeColumnsModal';
import { Pagination } from '../../components/ui/Pagination';
import { ItemComboBox } from '../../components/ui/ItemComboBox';
import { useListSearch } from '../../hooks/useListSearch';
import { useOrganizationName } from '../../hooks/useOrganizationName';
import type { Item } from '../items/items.schemas';
import { useRecordReportVisit } from './useRecordReportVisit';
import { reportsApi, type TakaReportQuery, type TakaReportRow } from './reports.api';
import { fetchLocations } from '../configuration/locations/locations.api';

const COLUMN_CATALOG = [
  { key: 'label', label: 'TAKA NO', locked: true, defaultVisible: true },
  { key: 'itemName', label: 'ITEM NAME', locked: true, defaultVisible: true },
  { key: 'batch', label: 'BATCH', defaultVisible: true },
  { key: 'locationName', label: 'LOCATION', defaultVisible: true },
  { key: 'qty', label: 'QUANTITY', defaultVisible: true },
  { key: 'receivedOn', label: 'RECEIVED ON', defaultVisible: true },
  { key: 'daysAtLocation', label: 'DAYS AT LOCATION', defaultVisible: true },
  { key: 'receivedQty', label: 'RECEIVED QTY', defaultVisible: false },
  { key: 'challanNumber', label: 'CHALLAN NUMBER', defaultVisible: false },
  { key: 'value', label: 'VALUE', defaultVisible: true },
];

const RIGHT_ALIGNED = new Set(['qty', 'daysAtLocation', 'receivedQty', 'value']);

const money = (value: number) =>
  `₹${value < 0 ? '-' : ''}${Math.abs(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

interface Applied {
  conditions: FilterCondition[];
}

export function TakaReportPage() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const organizationName = useOrganizationName();
  useRecordReportVisit(orgId, 'taka_report');

  const storageKey = `takaReportState_${orgId}`;
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

  const { data: locations } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId!),
    enabled: Boolean(orgId),
  });

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
      {
        key: 'locationName',
        label: 'Location',
        dataType: 'select',
        group: 'Report',
        options: locations?.map((l) => ({ label: l.name, value: l.name })) || [],
      },
      { key: 'batchText', label: 'Batch', dataType: 'string', group: 'Report' },
      { key: 'minAgeDays', label: 'Min Age (Days)', dataType: 'number', group: 'Report' },
      { key: 'asOnDate', label: 'As On Date', dataType: 'date', group: 'Report' },
    ],
    [orgId, locations],
  );

  const { page, setPage, perPage, setPerPage } = useListSearch();

  const query = useMemo<TakaReportQuery>(() => {
    const valueOf = (field: string) => {
      const value = applied.conditions.find((c) => c.field === field)?.value;
      return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    };
    const asOnDateValue = applied.conditions.find((c) => c.field === 'asOnDate')?.value as Date | undefined;
    return {
      itemName: valueOf('itemName'),
      locationName: valueOf('locationName'),
      batchText: valueOf('batchText'),
      minAgeDays: applied.conditions.find((c) => c.field === 'minAgeDays')?.value as number | undefined,
      asOnDate: asOnDateValue ? asOnDateValue.toISOString() : undefined,
      page,
      perPage,
    };
  }, [applied, page, perPage]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', orgId, 'taka', query],
    queryFn: () => reportsApi.getTakaReport(orgId!, query),
    enabled: Boolean(orgId),
  });

  const rows = data?.results ?? [];
  const total = data?.total ?? 0;
  
  const asOnDateValue = applied.conditions.find((c) => c.field === 'asOnDate')?.value as Date | undefined;
  const asOnText = asOnDateValue ? format(asOnDateValue, 'dd-MM-yyyy') : format(new Date(), 'dd-MM-yyyy');

  const cell = (row: TakaReportRow, key: string) => {
    switch (key) {
      case 'label':
        return row.label;
      case 'itemName':
        return row.itemName;
      case 'batch':
        return row.batch || '-';
      case 'locationName':
        return row.locationName;
      case 'qty':
        return row.qty.toFixed(2);
      case 'receivedOn':
        return row.receivedOn ? format(new Date(row.receivedOn), 'dd-MM-yyyy') : '-';
      case 'daysAtLocation':
        return row.daysAtLocation ?? '-';
      case 'receivedQty':
        return row.receivedQty?.toFixed(2) ?? '-';
      case 'challanNumber':
        return row.challanNumber || '-';
      case 'value':
        return money(row.value);
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
          <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '2px' }}>Inventory</div>
          <div style={{ fontSize: '16px', fontWeight: 500, color: '#111827' }}>
            Taka Report
            <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: '6px' }}>
              • As on {asOnText}
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

        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setShowColumnsModal(true)}
            style={{
              background: '#ffffff',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              padding: '6px 12px',
              color: '#374151',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontWeight: 500,
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
          >
            <Columns size={14} color="#6b7280" />
            <span className="action-btn-text">Customize Columns</span>
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
          {/* Report Header Text */}
          <div style={{ textAlign: 'center', padding: '32px 16px' }}>
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
              Taka Report
            </h2>
            <div style={{ fontSize: '13px', color: '#4b5563' }}>
              As on {asOnText}
            </div>
          </div>

          {/* Data Table */}
          <div className="responsive-table-wrapper" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1000px' }}>
              <thead>
                <tr style={{ borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
                  {visibleColumns.map((key) => (
                    <th
                      key={key}
                      style={{ ...thStyle, textAlign: 'center' }}
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
                          : 'No takas found'}
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
                            textAlign: 'center',
                            ...(RIGHT_ALIGNED.has(key) ? { fontWeight: 600 } : {}),
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
                          textAlign: 'center',
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
  whiteSpace: 'nowrap' as const,
};

const tdStyle = {
  padding: '12px 24px',
  fontSize: '13px',
  color: '#111827',
  borderBottom: '1px solid #f3f4f6',
  whiteSpace: 'nowrap' as const,
};
