import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link, useSearchParams } from 'react-router-dom';
import { Menu, Filter, X } from 'lucide-react';
import { format, endOfDay, startOfDay, startOfMonth } from 'date-fns';
import { ReportDateFilter } from './components/ReportDateFilter';
import {
  reportsApi,
  type PaginatedStockMovementResponse,
  type StockMovementRow,
} from './reports.api';

export function StockMovementReportPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { orgId } = useParams<{ orgId: string }>();

  const initialItemId = searchParams.get('itemId') || '';
  const initialLocationId = searchParams.get('locationId') || '';
  const initialMovementType =
    (searchParams.get('movementType') as 'inward' | 'outward' | 'all') || 'all';
  const initialFromDateStr = searchParams.get('fromDate');
  const initialToDateStr = searchParams.get('toDate');

  const initialFromDate = initialFromDateStr
    ? new Date(initialFromDateStr)
    : startOfMonth(new Date());
  const initialToDate = initialToDateStr ? new Date(initialToDateStr) : new Date();

  const [dateRangeLabel, setDateRangeLabel] = useState(
    initialFromDateStr && initialToDateStr ? 'Custom' : 'This Month',
  );
  const [fromDate, setFromDate] = useState<Date>(initialFromDate);
  const [toDate, setToDate] = useState<Date>(initialToDate);
  const [movementType, _setMovementType] = useState(initialMovementType);
  const [_itemIdFilter, _setItemIdFilter] = useState(initialItemId);

  const [appliedFilters, setAppliedFilters] = useState({
    fromDate: initialFromDate,
    toDate: initialToDate,
    movementType: initialMovementType,
    itemId: initialItemId,
    locationId: initialLocationId,
  });

  const [data, setData] = useState<PaginatedStockMovementResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      if (!orgId) return;
      setLoading(true);
      try {
        const response = await reportsApi.getStockMovement(orgId, {
          itemId: appliedFilters.itemId || undefined,
          locationId: appliedFilters.locationId || undefined,
          fromDate: startOfDay(appliedFilters.fromDate).toISOString(),
          toDate: endOfDay(appliedFilters.toDate).toISOString(),
          movementType: appliedFilters.movementType as 'all' | 'inward' | 'outward',
          page: 1,
          perPage: 100, // Just fetching top 100 for now to keep UI simple
        });
        setData(response);
      } catch (error) {
        console.error('Failed to fetch stock movement', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [orgId, appliedFilters]);

  const getDocLink = (row: StockMovementRow) => {
    // Basic mapping, assuming standard routes
    switch (row.source.toLowerCase().replace(/ /g, '_')) {
      case 'bill':
        return `/organizations/${orgId}/purchases/bills`;
      case 'job_receipt':
        return `/organizations/${orgId}/jobwork/receipts`;
      case 'job_issue':
        return `/organizations/${orgId}/jobwork/issues`;
      case 'purchase_order':
        return `/organizations/${orgId}/purchases/purchase-orders`;
      default:
        return null;
    }
  };

  const thStyle = {
    padding: '12px 16px',
    textAlign: 'left' as const,
    fontSize: '11px',
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  };

  const tdStyle = {
    padding: '12px 16px',
    fontSize: '13px',
    color: '#374151',
    borderBottom: '1px solid #f3f4f6',
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
            }}
          >
            <Menu size={18} color="#374151" />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#6b7280', fontSize: '14px', marginBottom: '8px' }}>Inventory</div>
            <div
              style={{
                fontSize: '18px',
                fontWeight: 600,
                color: '#111827',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              Stock Movement{' '}
              <span
                style={{ color: '#6b7280', fontSize: '14px', fontWeight: 400, marginLeft: '8px' }}
              >
                • From {format(appliedFilters.fromDate, 'dd-MM-yyyy')} To{' '}
                {format(appliedFilters.toDate, 'dd-MM-yyyy')}
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
          justifyContent: 'space-between',
          padding: '12px 24px',
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
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
            onClick={() =>
              setAppliedFilters({ fromDate, toDate, movementType, itemId: initialItemId, locationId: initialLocationId })
            }
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
              Stock Movement
            </h2>
            <div style={{ fontSize: '13px', color: '#4b5563' }}>
              From {format(fromDate, 'dd-MM-yyyy')} To {format(toDate, 'dd-MM-yyyy')}
            </div>
          </div>

          {/* Data Table */}
          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
              <thead>
              <tr style={{ borderTop: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6' }}>
                <th style={thStyle}>TRANSACTION DATE</th>
                <th style={thStyle}>TRANSACTION NUMBER</th>
                <th style={thStyle}>ITEM NAME</th>
                <th style={thStyle}>TRANSACTION</th>
                <th style={thStyle}>MOVEMENT TYPE</th>
                <th style={thStyle}>SOURCE</th>
                <th style={thStyle}>DESTINATION</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>QUANTITY</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#6b7280' }}>
                    Loading...
                  </td>
                </tr>
              ) : (data?.results?.length || 0) === 0 ? (
                <tr>
                  <td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#6b7280' }}>
                    No data found
                  </td>
                </tr>
              ) : (
                data?.results.map((row) => (
                  <tr
                    key={row.id}
                    className="table-row-hover"
                    style={{ borderBottom: '1px solid #f9fafb' }}
                  >
                    <td style={tdStyle}>{format(new Date(row.transactionDate), 'dd-MM-yyyy')}</td>
                    <td style={tdStyle}>
                      {getDocLink(row) ? (
                        <Link
                          to={getDocLink(row)!}
                          className="hover-underline"
                          style={{ color: '#0062ff', textDecoration: 'none' }}
                        >
                          {row.transactionNumber}
                        </Link>
                      ) : (
                        row.transactionNumber
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span
                        className="hover-underline"
                        style={{ color: '#0062ff', cursor: 'pointer' }}
                        onClick={() => navigate(`/organizations/${orgId}/items?id=${row.itemId}`)}
                      >
                        {row.itemName}
                      </span>
                    </td>
                    <td style={tdStyle} className="capitalize">
                      {row.transactionType}
                    </td>
                    <td style={tdStyle}>{row.movementType}</td>
                    <td style={tdStyle} className="capitalize">
                      {row.source}
                    </td>
                    <td style={tdStyle}>{row.destination}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>
                      {row.quantity.toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && data && data.results.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: '2px solid #e5e7eb', background: '#f9fafb' }}>
                  <td
                    colSpan={7}
                    style={{
                      padding: '12px 16px',
                      fontWeight: 600,
                      color: '#111827',
                      fontSize: '13px',
                    }}
                  >
                    Total
                  </td>
                  <td
                    style={{
                      padding: '12px 16px',
                      fontWeight: 600,
                      color: '#111827',
                      fontSize: '13px',
                      textAlign: 'right',
                    }}
                  >
                    {data.grandTotalQuantity.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
          </div>
        </div>
      </div>
    </div>
  );
}
