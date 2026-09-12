import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Menu, X, Filter, Columns, ChevronDown } from 'lucide-react';
import { format, endOfDay } from 'date-fns';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { AdvancedFilter } from '../../components/ui/AdvancedFilter/AdvancedFilter';
import type { FilterField, FilterCondition } from '../../components/ui/AdvancedFilter/filterUtils';
import { CustomizeColumnsModal } from '../../components/ui/CustomizeColumnsModal';
import { ReportDateFilter } from './components/ReportDateFilter';
import {
  reportsApi,
  type InventoryValuationRow,
  type InventoryValuationQuery,
} from './reports.api';
import { ItemComboBox } from '../../components/ui/ItemComboBox';
import type { Item } from '../items/items.schemas';

const STOCK_OPTIONS = [
  { label: 'No criteria', value: 'none' },
  { label: 'Greater than zero', value: 'gt' },
  { label: 'Less than or equal to zero', value: 'lte' },
  { label: 'Less than zero', value: 'lt' },
  { label: 'Equal to zero', value: 'eq' },
  { label: 'Not equal to zero', value: 'neq' },
];

const STATUS_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
];

// Filter fields are now dynamically generated in the component to access orgId

export function InventoryValuationSummaryPage() {
  const navigate = useNavigate();

  const [dateRange, setDateRange] = useState('Today');
  const [asOfDate, setAsOfDate] = useState<Date>(new Date());
  const [stockFilter, setStockFilter] = useState('none');
  const [statusFilter, setStatusFilter] = useState('all');
  const [conditions, setConditions] = useState<FilterCondition[]>([]);

  const [showColumnsModal, setShowColumnsModal] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([
    'itemName',
    'stockOnHand',
    'inventoryAssetValue',
  ]);

  const formattedAsOfDate = format(asOfDate, 'dd-MM-yyyy');

  const { orgId } = useParams<{ orgId: string }>();

  const filterFields = useMemo<FilterField[]>(
    () => [
      {
        key: 'itemName',
        label: 'Item Name',
        dataType: 'string',
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
      { key: 'categoryName', label: 'Category Name', dataType: 'string' },
    ],
    [orgId],
  );

  const [data, setData] = useState<InventoryValuationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!orgId) return;
    try {
      const query: InventoryValuationQuery = {
        asOfDate: endOfDay(asOfDate).toISOString(),
        stockAvailability: stockFilter as InventoryValuationQuery['stockAvailability'],
        status: statusFilter as InventoryValuationQuery['status'],
      };

      const itemNameCond = conditions.find((c) => c.field === 'itemName');
      if (itemNameCond && itemNameCond.value) {
        query.itemName = itemNameCond.value as string;
      }

      const catNameCond = conditions.find((c) => c.field === 'categoryName');
      if (catNameCond && catNameCond.value) {
        query.categoryName = catNameCond.value as string;
      }

      const rows = await reportsApi.getInventoryValuation(orgId, query);
      setData(rows);
    } catch (error) {
      console.error('Failed to fetch inventory valuation', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Record visit time for ReportsPage
    localStorage.setItem(`lastVisited_inventoryValuation_${orgId}`, new Date().toISOString());

    const init = async () => {
      await fetchData();
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const totalQty = data.reduce((sum, row) => sum + row.stockOnHand, 0);
  const totalValue = data.reduce((sum, row) => sum + row.inventoryAssetValue, 0);

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
              Inventory Valuation
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
              Inventory Valuation Summary
              <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: '6px' }}>
                • As of {formattedAsOfDate}
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
            value={dateRange}
            onChange={(label, date) => {
              setDateRange(label);
              setAsOfDate(date);
            }}
          />

          <SearchableSelect
            options={STOCK_OPTIONS}
            value={stockFilter}
            onChange={setStockFilter}
            style={{ width: 'max-content' }}
            triggerStyle={{
              border: '1px solid #d1d5db',
              background: '#fff',
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '12px',
              height: 'auto',
              minHeight: '0',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
            dropdownWidth="250px"
            renderValue={(opt) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#6b7280' }}>Stock Availability :</span>
                <span style={{ color: '#111827', fontWeight: 500 }}>{opt?.label}</span>
              </div>
            )}
          />

          <SearchableSelect
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 'max-content' }}
            triggerStyle={{
              border: '1px solid #d1d5db',
              background: '#fff',
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '12px',
              height: 'auto',
              minHeight: '0',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
            dropdownWidth="200px"
            renderValue={(opt) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#6b7280' }}>Status :</span>
                <span style={{ color: '#111827', fontWeight: 500 }}>{opt?.label}</span>
              </div>
            )}
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
          />

          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchData();
            }}
            style={{
              background: '#059669',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '4px 16px',
              fontSize: '12px',
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
      <div style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>
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
              Inventory Valuation Summary
            </h2>
            <div style={{ fontSize: '13px', color: '#4b5563' }}>As of {formattedAsOfDate}</div>
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
                    case 'uomName':
                      return (
                        <th key={colKey} style={thStyle}>
                          UNIT
                        </th>
                      );
                    case 'stockOnHand':
                      return (
                        <th key={colKey} style={{ ...thStyle, textAlign: 'right' }}>
                          STOCK ON HAND
                        </th>
                      );
                    case 'inventoryAssetValue':
                      return (
                        <th key={colKey} style={{ ...thStyle, textAlign: 'right' }}>
                          INVENTORY ASSET VALUE
                        </th>
                      );
                    default:
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
              ) : data.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length}
                    style={{ ...tdStyle, textAlign: 'center', color: '#6b7280' }}
                  >
                    No data found
                  </td>
                </tr>
              ) : (
                data.map((row) => (
                  <tr
                    key={row.itemId}
                    className="table-row-hover"
                    style={{ borderTop: '1px solid #f9fafb', cursor: 'pointer' }}
                    onClick={() =>
                      navigate(`/organizations/${orgId}/reports/inventory-valuation/${row.itemId}`)
                    }
                  >
                    {visibleColumns.map((colKey) => {
                      switch (colKey) {
                        case 'itemName':
                          return (
                            <td key={colKey} style={tdStyle}>
                              <span style={{ color: '#111827', fontWeight: 500 }}>
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
                        case 'uomName':
                          return (
                            <td key={colKey} style={tdStyle}>
                              {row.uomName || '-'}
                            </td>
                          );
                        case 'stockOnHand':
                          return (
                            <td
                              key={colKey}
                              style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}
                            >
                              {row.stockOnHand.toFixed(2)}
                            </td>
                          );
                        case 'inventoryAssetValue':
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
                              ₹{row.inventoryAssetValue < 0 ? '-' : ''}
                              {Math.abs(row.inventoryAssetValue).toLocaleString('en-IN', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                          );
                        default:
                          return null;
                      }
                    })}
                  </tr>
                ))
              )}
              {data.length > 0 && (
                <tr style={{ borderTop: '1px solid #e5e7eb' }}>
                  {visibleColumns.map((colKey, index) => {
                    if (index === 0) {
                      return (
                        <td key={colKey} style={{ ...tdStyle, fontWeight: 600 }}>
                          Total
                        </td>
                      );
                    }
                    if (colKey === 'stockOnHand') {
                      return (
                        <td
                          key={colKey}
                          style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}
                        >
                          {totalQty.toFixed(2)}
                        </td>
                      );
                    }
                    if (colKey === 'inventoryAssetValue') {
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
                          ₹{totalValue < 0 ? '-' : ''}
                          {Math.abs(totalValue).toLocaleString('en-IN', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                      );
                    }
                    return <td key={colKey} style={tdStyle} />; // Empty cell for non-total columns
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showColumnsModal && (
        <CustomizeColumnsModal
          isOpen={showColumnsModal}
          onClose={() => setShowColumnsModal(false)}
          catalog={[
            { key: 'itemName', label: 'ITEM NAME', locked: true, defaultVisible: true },
            { key: 'categoryName', label: 'CATEGORY NAME', defaultVisible: false },
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
