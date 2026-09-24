import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Menu, X, Filter, Columns, ChevronDown } from 'lucide-react';
import { format, endOfDay } from 'date-fns';
import { AdvancedFilter } from '../../components/ui/AdvancedFilter/AdvancedFilter';
import type { FilterField, FilterCondition } from '../../components/ui/AdvancedFilter/filterUtils';
import { CustomizeColumnsModal } from '../../components/ui/CustomizeColumnsModal';
import { ReportDateFilter } from './components/ReportDateFilter';
import { Pagination } from '../../components/ui/Pagination';
import { useListSearch } from '../../hooks/useListSearch';
import {
  reportsApi,
  type StockSummaryQuery,
  type PaginatedStockSummaryResponse,
} from './reports.api';
import { useRecordReportVisit } from './useRecordReportVisit';
import { ItemComboBox } from '../../components/ui/ItemComboBox';
import type { Item } from '../items/items.schemas';
import { CategorySelectDropdown } from '../items/components/CategorySelectDropdown';
import { useQuery } from '@tanstack/react-query';
import { fetchLocations, isOwnLocation } from '../configuration/locations/locations.api';
import { LocalComboBox } from '../../components/ui/LocalComboBox';
import { useActiveCustomFields } from '../custom-fields/customFields.api';
import type { FilterDataType } from '../../components/ui/AdvancedFilter/filterUtils';
// Filter fields are now dynamically generated in the component to access orgId

export function StockSummaryReportPage() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  useRecordReportVisit(orgId, 'stock_summary');

  const initialState = useMemo(() => {
    if (!orgId) return null;
    const key = `stockSummaryState_${orgId}`;
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);

        const safeDate = (val: string | number | null | undefined, fallback: Date) => {
          if (!val) return fallback;
          const d = new Date(val);
          return isNaN(d.getTime()) ? fallback : d;
        };

        parsed.fromDate = safeDate(
          parsed.fromDate,
          new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        );
        parsed.toDate = safeDate(parsed.toDate, new Date());

        if (parsed.appliedFilters) {
          parsed.appliedFilters.fromDate = safeDate(
            parsed.appliedFilters.fromDate,
            new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          );
          parsed.appliedFilters.toDate = safeDate(parsed.appliedFilters.toDate, new Date());
        }

        return parsed;
      }
    } catch (_e) {
      // ignore parse errors and fallback to default state
    }
    return null;
  }, [orgId]);

  const [dateRange, setDateRange] = useState(initialState?.dateRange || 'This Month');
  const [fromDate, setFromDate] = useState<Date>(
    initialState?.fromDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [toDate, setToDate] = useState<Date>(initialState?.toDate || new Date());
  const [stockFilter] = useState('none');
  const [conditions, setConditions] = useState<FilterCondition[]>(initialState?.conditions || []);

  const [appliedFilters, setAppliedFilters] = useState<{
    fromDate: Date;
    toDate: Date;
    stockFilter: string;
    conditions: FilterCondition[];
  }>(
    initialState?.appliedFilters || {
      fromDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      toDate: new Date(),
      stockFilter: 'none',
      conditions: [] as FilterCondition[],
    },
  );

  useEffect(() => {
    if (!orgId) return;
    sessionStorage.setItem(
      `stockSummaryState_${orgId}`,
      JSON.stringify({
        dateRange,
        fromDate,
        toDate,
        conditions,
        appliedFilters,
      }),
    );
  }, [dateRange, fromDate, toDate, conditions, appliedFilters, orgId]);

  const [showColumnsModal, setShowColumnsModal] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([
    'itemName',
    'sku',
    'openingStock',
    'quantityIn',
    'quantityOut',
    'closingStock',
  ]);

  const formattedFromDate = format(appliedFilters.fromDate, 'dd-MM-yyyy');
  const formattedToDate = format(appliedFilters.toDate, 'dd-MM-yyyy');

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId!),
    enabled: Boolean(orgId),
  });

  const { data: customFields = [] } = useActiveCustomFields(orgId, 'item');

  const locationOptions = useMemo(
    () => locations.filter(isOwnLocation).map((loc) => ({ label: loc.name, value: loc.id })),
    [locations],
  );

  const customFilterFields = useMemo(() => {
    return customFields.map((cf) => {
      let dataType: FilterDataType = 'string';
      if (cf.dataType === 'number' || cf.dataType === 'decimal') dataType = 'number';
      else if (cf.dataType === 'date') dataType = 'date';
      else if (cf.dataType === 'checkbox') dataType = 'boolean';
      else if (cf.dataType === 'select') dataType = 'select';
      else if (cf.dataType === 'multi_select') dataType = 'multi_select';

      const options = cf.config?.options?.map((opt) => ({ label: opt.label, value: opt.id }));

      return {
        key: cf.key,
        label: cf.label,
        dataType,
        group: 'Item',
        options,
      } as FilterField;
    });
  }, [customFields]);

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
              placeholder="Search by item name..."
              portal
            />
          </div>
        ),
      },
      {
        key: 'categoryName',
        label: 'Category Name',
        dataType: 'string',
        group: 'Report',
        renderInput: ({ value, onChange }) => (
          <div style={{ flex: 1, minWidth: 200 }}>
            <CategorySelectDropdown
              value={(value as string) || ''}
              onChange={(val) => onChange(val)}
              hideManageButton={true}
            />
          </div>
        ),
      },
      {
        key: 'locationId',
        label: 'Location',
        dataType: 'string',
        group: 'Locations',
        renderInput: ({ value, onChange }) => (
          <div style={{ flex: 1, minWidth: 200 }}>
            <LocalComboBox
              options={locationOptions}
              value={(value as string) || null}
              onChange={(val) => onChange(val || '')}
              placeholder="Select location..."
              portal
            />
          </div>
        ),
      },
      {
        key: 'sku',
        label: 'SKU',
        dataType: 'string',
        group: 'Item',
      },
      {
        key: 'hsnCode',
        label: 'HSN Code',
        dataType: 'string',
        group: 'Item',
      },
      ...customFilterFields,
    ],
    [orgId, locationOptions, customFilterFields],
  );

  const { page, setPage, perPage, setPerPage } = useListSearch();

  const [data, setData] = useState<PaginatedStockSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!orgId) return;
    try {
      const query: StockSummaryQuery = {
        fromDate: appliedFilters.fromDate.toISOString(),
        toDate: endOfDay(appliedFilters.toDate).toISOString(),
        page,
        perPage,
      };

      const itemNameCond = appliedFilters.conditions.find((c) => c.field === 'itemName');
      if (itemNameCond && itemNameCond.value) {
        query.itemName = itemNameCond.value as string;
      }

      const catNameCond = appliedFilters.conditions.find((c) => c.field === 'categoryName');
      if (catNameCond && catNameCond.value) {
        query.categoryName = catNameCond.value as string;
      }

      const locationCond = appliedFilters.conditions.find((c) => c.field === 'locationId');
      if (locationCond && locationCond.value) {
        query.locationId = locationCond.value as string;
      }

      const skuCond = appliedFilters.conditions.find((c) => c.field === 'sku');
      if (skuCond && skuCond.value) {
        query.sku = skuCond.value as string;
      }

      const hsnCodeCond = appliedFilters.conditions.find((c) => c.field === 'hsnCode');
      if (hsnCodeCond && hsnCodeCond.value) {
        query.hsnCode = hsnCodeCond.value as string;
      }

      // Extract custom fields conditions
      const customFieldKeys = new Set(customFields.map((cf) => cf.key));
      const itemCustomFields: Record<string, unknown> = {};
      appliedFilters.conditions.forEach((c) => {
        if (
          customFieldKeys.has(c.field) &&
          c.value !== undefined &&
          c.value !== null &&
          c.value !== ''
        ) {
          itemCustomFields[c.field] = c.value;
        }
      });
      if (Object.keys(itemCustomFields).length > 0) {
        query.itemCustomFields = itemCustomFields;
      }

      const response = await reportsApi.getStockSummary(orgId, query);
      setData(response);
    } catch (error) {
      console.error('Failed to fetch Stock Summary', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      await fetchData();
    };
    init();
  }, [orgId, page, perPage, appliedFilters]);

  const rows = data?.results || [];
  const grandTotalOpening = data?.grandTotalOpening || 0;
  const grandTotalIn = data?.grandTotalIn || 0;
  const grandTotalOut = data?.grandTotalOut || 0;
  const grandTotalClosing = data?.grandTotalClosing || 0;
  const total = data?.total || 0;

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
          padding: '12px 24px',
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            type="button"
            style={{
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '6px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            }}
          >
            <Menu size={18} color="#4b5563" />
          </button>
          <div>
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '2px' }}>
              Stock Summary
            </div>
            <div
              style={{
                fontSize: '16px',
                fontWeight: 500,
                color: '#111827',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              Stock Summary Report
              <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: '6px' }}>
                • From {formattedFromDate} To {formattedToDate}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate(-1)}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: '#ef4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4px',
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

        <div style={{ display: 'flex', gap: '12px', flex: 1 }}>
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
            onClick={() => setAppliedFilters({ fromDate, toDate, stockFilter, conditions })}
            style={{
              padding: '6px 12px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
          >
            Run Report
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ padding: '12px', flex: 1, overflowY: 'auto' }}>
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
          {/* Top Right Controls in Card */}
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
              Customize Report Columns
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
          <div style={{ textAlign: 'center', padding: '56px 0 32px' }}>
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
              OCTFIS TECHNO llp
            </div>
            <h2
              style={{ fontSize: '18px', fontWeight: 600, color: '#111827', margin: '0 0 8px 0' }}
            >
              Stock Summary Report
            </h2>
            <div style={{ fontSize: '13px', color: '#4b5563' }}>
              From {formattedFromDate} To {formattedToDate}
            </div>
          </div>

          {/* Data Table */}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
                {visibleColumns.map((colKey) => {
                  switch (colKey) {
                    case 'itemName':
                      return (
                        <th key={colKey} style={thStyle}>
                          ITEM NAME{' '}
                          <ChevronDown
                            size={12}
                            color="#9ca3af"
                            style={{
                              display: 'inline',
                              verticalAlign: 'middle',
                              marginLeft: '4px',
                            }}
                          />
                        </th>
                      );
                    case 'categoryName':
                      return (
                        <th key={colKey} style={thStyle}>
                          CATEGORY NAME
                        </th>
                      );
                    case 'sku':
                      return (
                        <th key={colKey} style={thStyle}>
                          SKU
                        </th>
                      );
                    case 'hsnCode':
                      return (
                        <th key={colKey} style={thStyle}>
                          HSN CODE
                        </th>
                      );
                    case 'uomName':
                      return (
                        <th key={colKey} style={thStyle}>
                          UNIT
                        </th>
                      );
                    case 'openingStock':
                      return (
                        <th key={colKey} style={{ ...thStyle, textAlign: 'right' }}>
                          OPENING STOCK
                        </th>
                      );
                    case 'quantityIn':
                      return (
                        <th key={colKey} style={{ ...thStyle, textAlign: 'right' }}>
                          QUANTITY IN
                        </th>
                      );
                    case 'quantityOut':
                      return (
                        <th key={colKey} style={{ ...thStyle, textAlign: 'right' }}>
                          QUANTITY OUT
                        </th>
                      );
                    case 'closingStock':
                      return (
                        <th key={colKey} style={{ ...thStyle, textAlign: 'right' }}>
                          CLOSING STOCK
                        </th>
                      );
                    default:
                      if (colKey.startsWith('cf_')) {
                        const cfKey = colKey.replace('cf_', '');
                        const cfLabel = customFields.find((cf) => cf.key === cfKey)?.label || cfKey;
                        return (
                          <th key={colKey} style={thStyle}>
                            {cfLabel.toUpperCase()}
                          </th>
                        );
                      }
                      return null;
                  }
                })}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length}
                    style={{ ...tdStyle, textAlign: 'center', color: '#6b7280' }}
                  >
                    Loading...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length}
                    style={{ ...tdStyle, textAlign: 'center', color: '#6b7280' }}
                  >
                    No data found
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.itemId}
                    className="table-row-hover"
                    style={{ borderTop: '1px solid #f9fafb' }}
                  >
                    {visibleColumns.map((colKey) => {
                      switch (colKey) {
                        case 'itemName':
                          return (
                            <td key={colKey} style={tdStyle}>
                              <span
                                className="hover-underline"
                                style={{ color: '#0062ff', fontWeight: 500, cursor: 'pointer' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/organizations/${orgId}/items?id=${row.itemId}`);
                                }}
                              >
                                {row.itemName}
                              </span>{' '}
                              <span style={{ color: '#9ca3af', fontSize: '12px' }}>
                                ({row.uomName || 'unit'})
                              </span>
                            </td>
                          );
                        case 'categoryName':
                          return (
                            <td key={colKey} style={tdStyle}>
                              {row.categoryName || '-'}
                            </td>
                          );
                        case 'sku':
                          return (
                            <td key={colKey} style={tdStyle}>
                              {row.sku || '-'}
                            </td>
                          );
                        case 'hsnCode':
                          return (
                            <td key={colKey} style={tdStyle}>
                              {row.hsnCode || '-'}
                            </td>
                          );
                        case 'uomName':
                          return (
                            <td key={colKey} style={tdStyle}>
                              {row.uomName || '-'}
                            </td>
                          );
                        case 'openingStock':
                          return (
                            <td
                              key={colKey}
                              style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}
                            >
                              {(row.openingStock || 0).toFixed(2)}
                            </td>
                          );
                        case 'quantityIn':
                          return (
                            <td
                              key={colKey}
                              style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}
                            >
                              <span
                                className="hover-underline"
                                style={{ color: '#0062ff', cursor: 'pointer' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(
                                    `/organizations/${orgId}/reports/stock-movement?itemId=${row.itemId}&movementType=inward&fromDate=${appliedFilters.fromDate.toISOString()}&toDate=${appliedFilters.toDate.toISOString()}`,
                                  );
                                }}
                              >
                                {(row.quantityIn || 0).toFixed(2)}
                              </span>
                            </td>
                          );
                        case 'quantityOut':
                          return (
                            <td
                              key={colKey}
                              style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}
                            >
                              <span
                                className="hover-underline"
                                style={{ color: '#0062ff', cursor: 'pointer' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(
                                    `/organizations/${orgId}/reports/stock-movement?itemId=${row.itemId}&movementType=outward&fromDate=${appliedFilters.fromDate.toISOString()}&toDate=${appliedFilters.toDate.toISOString()}`,
                                  );
                                }}
                              >
                                {(row.quantityOut || 0).toFixed(2)}
                              </span>
                            </td>
                          );
                        case 'closingStock':
                          return (
                            <td
                              key={colKey}
                              style={{
                                ...tdStyle,
                                textAlign: 'right',
                                color: '#111827',
                                fontWeight: 600,
                              }}
                            >
                              {(row.closingStock || 0).toFixed(2)}
                            </td>
                          );
                        default:
                          if (colKey.startsWith('cf_')) {
                            const cfKey = colKey.replace('cf_', '');
                            const cfValue = row.customFields?.[cfKey];
                            return (
                              <td key={colKey} style={tdStyle}>
                                {cfValue !== undefined && cfValue !== null ? String(cfValue) : '-'}
                              </td>
                            );
                          }
                          return null;
                      }
                    })}
                  </tr>
                ))
              )}
              {rows.length > 0 && (
                <tr style={{ borderTop: '1px solid #e5e7eb' }}>
                  {visibleColumns.map((colKey, index) => {
                    if (index === 0) {
                      return (
                        <td key={colKey} style={{ ...tdStyle, fontWeight: 600 }}>
                          Total
                        </td>
                      );
                    }
                    if (colKey === 'openingStock') {
                      return (
                        <td
                          key={colKey}
                          style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}
                        >
                          {grandTotalOpening.toFixed(2)}
                        </td>
                      );
                    }
                    if (colKey === 'quantityIn') {
                      return (
                        <td
                          key={colKey}
                          style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}
                        >
                          {grandTotalIn.toFixed(2)}
                        </td>
                      );
                    }
                    if (colKey === 'quantityOut') {
                      return (
                        <td
                          key={colKey}
                          style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}
                        >
                          {grandTotalOut.toFixed(2)}
                        </td>
                      );
                    }
                    if (colKey === 'closingStock') {
                      return (
                        <td
                          key={colKey}
                          style={{
                            ...tdStyle,
                            textAlign: 'right',
                            fontWeight: 700,
                            color: '#111827',
                          }}
                        >
                          {grandTotalClosing.toFixed(2)}
                        </td>
                      );
                    }
                    return <td key={colKey} style={tdStyle} />; // Empty cell for non-total columns
                  })}
                </tr>
              )}
            </tbody>
          </table>

          <Pagination
            pageContext={{
              page: data?.page || page,
              perPage: data?.perPage || perPage,
              hasMore: data?.page && data?.totalPages ? data.page < data.totalPages : false,
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
          catalog={[
            { key: 'itemName', label: 'ITEM NAME', locked: true, defaultVisible: true },
            { key: 'categoryName', label: 'CATEGORY NAME', defaultVisible: false },
            { key: 'sku', label: 'SKU', defaultVisible: false },
            { key: 'hsnCode', label: 'HSN CODE', defaultVisible: false },
            ...customFields.map((cf) => ({
              key: `cf_${cf.key}`,
              label: cf.label.toUpperCase(),
              defaultVisible: false,
            })),
            { key: 'uomName', label: 'UNIT', defaultVisible: false },
            { key: 'stockOnHand', label: 'STOCK ON HAND', defaultVisible: true },
            { key: 'inventoryAssetValue', label: 'INVENTORY ASSET VALUE', defaultVisible: true },
          ]}
          visible={visibleColumns}
          onSave={(newCols) => {
            setVisibleColumns(newCols);
            setShowColumnsModal(false);
          }}
        />
      )}
    </div>
  );
}

const thStyle = {
  padding: '12px 24px',
  textAlign: 'left' as const,
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
