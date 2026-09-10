import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Menu, X, Filter, Columns, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { AdvancedFilter } from '../../components/ui/AdvancedFilter/AdvancedFilter';
import type { FilterField, FilterCondition } from '../../components/ui/AdvancedFilter/filterUtils';
import { CustomizeColumnsModal } from '../../components/ui/CustomizeColumnsModal';
import { ReportDateFilter } from './components/ReportDateFilter';
import { reportsApi, type InventoryValuationRow, type InventoryValuationQuery } from './reports.api';

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

const FILTER_FIELDS: FilterField[] = [
  { key: 'itemName', label: 'Item Name', dataType: 'string' },
  { key: 'categoryName', label: 'Category Name', dataType: 'string' }
];

export function InventoryValuationSummaryPage() {
  const navigate = useNavigate();
  const today = format(new Date(), 'dd-MM-yyyy');

  const [dateRange, setDateRange] = useState('This Week');
  const [stockFilter, setStockFilter] = useState('none');
  const [statusFilter, setStatusFilter] = useState('all');
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  
  const [showColumnsModal, setShowColumnsModal] = useState(false);

  const { orgId } = useParams<{ orgId: string }>();
  const [data, setData] = useState<InventoryValuationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!orgId) return;
    try {
      const rows = await reportsApi.getInventoryValuation(orgId, {
        stockAvailability: stockFilter as InventoryValuationQuery['stockAvailability'],
        status: statusFilter as InventoryValuationQuery['status'],
      });
      setData(rows);
    } catch (error) {
      console.error('Failed to fetch inventory valuation', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      await fetchData();
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const totalQty = data.reduce((sum, row) => sum + row.stockOnHand, 0);
  const totalValue = data.reduce((sum, row) => sum + row.inventoryAssetValue, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f4f5f7', fontFamily: 'Inter, system-ui, sans-serif' }}>
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
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '2px' }}>Inventory Valuation</div>
            <div style={{ fontSize: '16px', fontWeight: 500, color: '#111827', display: 'flex', alignItems: 'center' }}>
              Inventory Valuation Summary
              <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: '6px' }}>• As of {today}</span>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#4b5563', fontSize: '13px', fontWeight: 500 }}>
          <Filter size={14} color="#6b7280" />
          Filters :
        </div>

        <div style={{ display: 'flex', gap: '12px', flex: 1 }}>
          <ReportDateFilter value={dateRange} onChange={setDateRange} />
          
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
            fields={FILTER_FIELDS}
            conditions={conditions}
            onChange={setConditions}
            align="left"
            matchType="all"
            triggerIcon={<span style={{ fontSize: '14px', marginRight: '4px', color: '#2563eb' }}>+</span>}
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
          <div style={{ position: 'absolute', top: '16px', right: '16px', display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#6b7280' }}>
              Group By : <span style={{ color: '#111827', fontWeight: 500 }}>Category Name</span>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#ef4444', display: 'flex', alignItems: 'center' }}><X size={12} /></button>
              <ChevronDown size={14} style={{ marginLeft: '4px' }} />
            </div>
            <div style={{ width: '1px', height: '14px', background: '#e5e7eb' }} />
            <button
              type="button"
              onClick={() => setShowColumnsModal(true)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#111827',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              <Columns size={14} color="#6b7280" />
              Customize Report Columns
              <span style={{ background: '#eff6ff', color: '#2563eb', padding: '2px 6px', borderRadius: '10px', fontSize: '11px', fontWeight: 600 }}>3</span>
            </button>
          </div>

          {/* Report Header Text */}
          <div style={{ textAlign: 'center', padding: '56px 0 40px' }}>
            <div style={{ fontSize: '12px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', fontWeight: 500 }}>
              OCTFIS TECHNO llp
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#111827', margin: '0 0 8px 0' }}>
              Inventory Valuation Summary
            </h2>
            <div style={{ fontSize: '13px', color: '#4b5563' }}>
              As of {today}
            </div>
          </div>

          {/* Data Table */}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderTop: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6' }}>
                <th style={thStyle}>ITEM NAME <ChevronDown size={12} color="#9ca3af" style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '2px' }}/></th>
                <th style={{ ...thStyle, textAlign: 'right' }}>STOCK ON HAND</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>INVENTORY ASSET VALUE</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={3} style={{ ...tdStyle, textAlign: 'center', color: '#6b7280' }}>Loading...</td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ ...tdStyle, textAlign: 'center', color: '#6b7280' }}>No data found</td>
                </tr>
              ) : (
                data.map((row) => (
                  <tr key={row.itemId} style={{ borderTop: '1px solid #f9fafb' }}>
                    <td style={tdStyle}>
                      {row.itemName} <span style={{ color: '#9ca3af' }}>({row.uomName || 'unit'})</span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{row.stockOnHand.toFixed(2)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: '#2563eb' }}>
                      ₹{row.inventoryAssetValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
              )}
              <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>Total</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{totalQty.toFixed(2)}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>
                  ₹{totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
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
            { key: 'stockOnHand', label: 'STOCK ON HAND', defaultVisible: true },
            { key: 'inventoryAssetValue', label: 'INVENTORY ASSET VALUE', defaultVisible: true },
          ]}
          visible={['itemName', 'stockOnHand', 'inventoryAssetValue']}
          onSave={() => setShowColumnsModal(false)}
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
