import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link, useLocation } from 'react-router-dom';
import { Menu, X, Filter } from 'lucide-react';
import { format, endOfDay, startOfDay, startOfMonth } from 'date-fns';
import { ReportDateFilter } from './components/ReportDateFilter';
import { reportsApi, type ItemLedgerResponse, type ItemLedgerRow } from './reports.api';

export function InventoryValuationDetailPage() {
  const navigate = useNavigate();
  const { orgId, itemId } = useParams<{ orgId: string; itemId: string }>();
  const location = useLocation();
  const locationId = new URLSearchParams(location.search).get('locationId') || undefined;

  const [dateRangeLabel, setDateRangeLabel] = useState('This Month');
  const [fromDate, setFromDate] = useState<Date>(startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date>(new Date());

  const [appliedFilters, setAppliedFilters] = useState({
    fromDate: startOfMonth(new Date()),
    toDate: new Date(),
  });

  const [data, setData] = useState<ItemLedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      if (!orgId || !itemId) return;
      setLoading(true);
      try {
        const response = await reportsApi.getItemLedger(orgId, itemId, {
          locationId,
          fromDate: startOfDay(appliedFilters.fromDate).toISOString(),
          toDate: endOfDay(appliedFilters.toDate).toISOString(),
        });
        setData(response);
      } catch (error) {
        console.error('Failed to fetch item ledger', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [orgId, itemId, appliedFilters, locationId]);

  const getDocLink = (row: ItemLedgerRow) => {
    if (!row.sourceDocId) return null;

    // Add routing for specific document types based on standard URL paths in this app
    switch (row.sourceDocType) {
      case 'bill':
        return `/organizations/${orgId}/purchases/bills/${row.sourceDocId}/edit`;
      case 'invoice':
        return `/organizations/${orgId}/sales/customers`; // Actually we don't have invoices in router yet, default to customers
      case 'job_receipt':
        return `/organizations/${orgId}/jobwork/receipts`; // Or specific receipt id view
      case 'job_issue':
        return `/organizations/${orgId}/jobwork/issues`;
      case 'purchase_order':
        return `/organizations/${orgId}/purchases/purchase-orders/${row.sourceDocId}/edit`;
      case 'item_opening_stock':
        return `/organizations/${orgId}/items/${itemId}/opening-stock`;
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
        fontFamily:
          '"Open Sans", "WebFont", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
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
              Item Detail Report
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
            value={dateRangeLabel}
            onChangeRange={(label, start, end) => {
              setDateRangeLabel(label);
              setFromDate(start);
              setToDate(end);
            }}
          />
          <button
            type="button"
            onClick={() => setAppliedFilters({ fromDate, toDate })}
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
          {/* Report Header Text */}
          <div style={{ textAlign: 'center', padding: '56px 0 40px' }}>
            <div
              style={{
                fontSize: '12px',
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
              style={{ fontSize: '20px', fontWeight: 600, color: '#111827', margin: '0 0 8px 0' }}
            >
              Inventory Valuation for {data?.itemInfo?.itemName} ( {data?.itemInfo?.sku || 'N/A'} )
            </h2>
            <div style={{ fontSize: '13px', color: '#4b5563' }}>
              From {format(fromDate, 'dd-MM-yyyy')} To {format(toDate, 'dd-MM-yyyy')}
            </div>
          </div>

          {/* Data Table */}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderTop: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6' }}>
                <th style={thStyle}>DATE</th>
                <th style={thStyle}>TRANSACTION DETAILS</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>QUANTITY</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>UNIT COST</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>TOTAL COST</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>STOCK ON HAND</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>INVENTORY ASSET VALUE</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#6b7280' }}>
                    Loading...
                  </td>
                </tr>
              ) : !data || data.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#6b7280' }}>
                    No data found
                  </td>
                </tr>
              ) : (
                data.rows.map((row, idx, arr) => {
                  let rowSpan = 1;
                  if (row.transactionDetails !== '') {
                    let j = idx + 1;
                    while (j < arr.length && arr[j].transactionDetails === '') {
                      rowSpan++;
                      j++;
                    }
                  } else {
                    rowSpan = 0;
                  }

                  const isSpecial = row.isOpeningStock || row.isClosingStock;
                  const docLink = getDocLink(row);

                  return (
                    <tr key={idx} className="table-row-hover">
                      {rowSpan > 0 && (
                        <td
                          style={{ ...tdStyle, verticalAlign: 'top', fontWeight: 500 }}
                          rowSpan={rowSpan}
                        >
                          {row.date
                            ? format(new Date(row.date), 'dd-MM-yyyy')
                            : row.isOpeningStock
                              ? format(fromDate, 'dd-MM-yyyy')
                              : row.isClosingStock
                                ? format(toDate, 'dd-MM-yyyy')
                                : ''}
                        </td>
                      )}
                      {rowSpan > 0 && (
                        <td style={{ ...tdStyle, verticalAlign: 'top' }} rowSpan={rowSpan}>
                          {isSpecial ? (
                            <span style={{ color: '#059669', fontStyle: 'italic' }}>
                              {row.transactionDetails}
                            </span>
                          ) : docLink ? (
                            <Link to={docLink} style={{ color: '#2563eb', textDecoration: 'none' }}>
                              {row.transactionDetails}{' '}
                              {row.sourceDocNumber
                                ? '# ' + row.sourceDocNumber
                                : row.sourceDocId
                                  ? '# ' + row.sourceDocId.substring(0, 8)
                                  : ''}
                            </Link>
                          ) : (
                            <span>{row.transactionDetails}</span>
                          )}
                        </td>
                      )}
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: 'right',
                          fontWeight: 500,
                          color: row.quantity < 0 ? '#ef4444' : '#222',
                        }}
                      >
                        {row.quantity !== 0 ? row.quantity.toFixed(2) : ''}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500 }}>
                        {row.unitCost !== null ? row.unitCost.toFixed(2) : ''}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500 }}>
                        {row.totalCost !== 0
                          ? row.totalCost.toLocaleString('en-IN', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : ''}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500 }}>
                        {row.stockOnHand.toFixed(2)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500 }}>
                        {row.inventoryAssetValue.toLocaleString('en-IN', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
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
};
