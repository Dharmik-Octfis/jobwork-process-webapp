import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link, useSearchParams } from 'react-router-dom';
import { Menu, Filter, X } from 'lucide-react';
import { format, endOfDay, startOfDay, startOfMonth } from 'date-fns';
import { ReportDateFilter } from './components/ReportDateFilter';
import { useOrganizationName } from '../../hooks/useOrganizationName';
import {
  reportsApi,
  type PaginatedStockMovementResponse,
  type StockMovementRow,
} from './reports.api';
import { useTableSort } from '../../hooks/useTableSort';
import { SortableHeader } from '../../components/ui/SortableHeader';
import { ReportExportMenu } from './components/ReportExportMenu';

export function StockMovementReportPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { orgId } = useParams<{ orgId: string }>();
  const organizationName = useOrganizationName();

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
  const rows = data?.results || [];
  const { sortedRows, sortField, sortDirection, handleSort } = useTableSort(rows);
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
        return `/organizations/${orgId}/purchases/bills?id=${row.sourceDocId}`;
      case 'job_receipt':
        return `/organizations/${orgId}/jobwork/receipts?id=${row.sourceDocId}`;
      case 'job_issue':
        return `/organizations/${orgId}/jobwork/issues?id=${row.sourceDocId}`;
      case 'purchase_order':
        return `/organizations/${orgId}/purchases/purchase-orders?id=${row.sourceDocId}`;
      case 'inventory_adjustment':
        return `/organizations/${orgId}/inventory/adjustments?id=${row.sourceDocId}`;
      case 'invoice':
        return `/organizations/${orgId}/sales/invoices?id=${row.sourceDocId}`;
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

  const exportColumns = [
    { key: 'transactionDate', label: 'TRANSACTION DATE', align: 'left' as const },
    { key: 'transactionNumber', label: 'TRANSACTION NUMBER', align: 'left' as const },
    { key: 'itemName', label: 'ITEM NAME', align: 'left' as const },
    { key: 'transactionType', label: 'TRANSACTION', align: 'left' as const },
    { key: 'movementType', label: 'MOVEMENT TYPE', align: 'left' as const },
    { key: 'source', label: 'SOURCE', align: 'left' as const },
    { key: 'destination', label: 'DESTINATION', align: 'left' as const },
    { key: 'quantity', label: 'QUANTITY', align: 'right' as const },
  ];

  const exportRows = sortedRows.map((row) => [
    format(new Date(row.transactionDate), 'dd-MM-yyyy'),
    row.transactionNumber || '-',
    row.itemName || '-',
    row.transactionType || '-',
    row.movementType || '-',
    row.source || '-',
    row.destination || '-',
    Number(row.quantity || 0).toFixed(2),
  ]);

  const totalQuantity = sortedRows.reduce((sum, r) => sum + (r.quantity || 0), 0);
  const exportTotalRow = ['TOTAL', '', '', '', '', '', '', totalQuantity.toFixed(2)];

  const fetchExportData = async () => {
    if (!orgId) return { data: [] };
    const response = await reportsApi.getStockMovement(orgId, {
      itemId: appliedFilters.itemId || undefined,
      locationId: appliedFilters.locationId || undefined,
      fromDate: startOfDay(appliedFilters.fromDate).toISOString(),
      toDate: endOfDay(appliedFilters.toDate).toISOString(),
      movementType: appliedFilters.movementType as 'all' | 'inward' | 'outward',
    });
    const allRows = response?.results || [];
    const allExportRows = allRows.map((row) => [
      format(new Date(row.transactionDate), 'dd-MM-yyyy'),
      row.transactionNumber || '-',
      row.itemName || '-',
      row.transactionType || '-',
      row.movementType || '-',
      row.source || '-',
      row.destination || '-',
      Number(row.quantity || 0).toFixed(2),
    ]);
    const totalQty = allRows.reduce((sum, r) => sum + (r.quantity || 0), 0);
    const allTotalRow = ['TOTAL', '', '', '', '', '', '', totalQty.toFixed(2)];
    return { data: allExportRows, totalRow: allTotalRow };
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#f4f5f7',
        fontFamily:
          '"Zoho Puvi", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ReportExportMenu
            orgName={organizationName || 'OCTFIS TECHNO LLP'}
            reportTitle="Stock Movement Report"
            dateSubtitle={`From ${format(appliedFilters.fromDate, 'dd-MM-yyyy')} To ${format(appliedFilters.toDate, 'dd-MM-yyyy')}`}
            columns={exportColumns}
            data={exportRows}
            totalRow={exportTotalRow}
            fetchExportData={fetchExportData}
          />

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
              setAppliedFilters({
                fromDate,
                toDate,
                movementType,
                itemId: initialItemId,
                locationId: initialLocationId,
              })
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
              {organizationName}
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
                  <SortableHeader
                    sortKey="transactionDate"
                    label="TRANSACTION DATE"
                    currentSortField={sortField as string}
                    currentSortDirection={sortDirection}
                    onSort={handleSort}
                    style={thStyle}
                    align="left"
                  />
                  <SortableHeader
                    sortKey="transactionNumber"
                    label="TRANSACTION NUMBER"
                    currentSortField={sortField as string}
                    currentSortDirection={sortDirection}
                    onSort={handleSort}
                    style={thStyle}
                    align="left"
                  />
                  <SortableHeader
                    sortKey="itemName"
                    label="ITEM NAME"
                    currentSortField={sortField as string}
                    currentSortDirection={sortDirection}
                    onSort={handleSort}
                    style={thStyle}
                    align="left"
                  />
                  <SortableHeader
                    sortKey="transactionType"
                    label="TRANSACTION"
                    currentSortField={sortField as string}
                    currentSortDirection={sortDirection}
                    onSort={handleSort}
                    style={thStyle}
                    align="left"
                  />
                  <SortableHeader
                    sortKey="movementType"
                    label="MOVEMENT TYPE"
                    currentSortField={sortField as string}
                    currentSortDirection={sortDirection}
                    onSort={handleSort}
                    style={thStyle}
                    align="left"
                  />
                  <SortableHeader
                    sortKey="source"
                    label="SOURCE"
                    currentSortField={sortField as string}
                    currentSortDirection={sortDirection}
                    onSort={handleSort}
                    style={thStyle}
                    align="left"
                  />
                  <SortableHeader
                    sortKey="destination"
                    label="DESTINATION"
                    currentSortField={sortField as string}
                    currentSortDirection={sortDirection}
                    onSort={handleSort}
                    style={thStyle}
                    align="left"
                  />
                  <SortableHeader
                    sortKey="quantity"
                    label="QUANTITY"
                    currentSortField={sortField as string}
                    currentSortDirection={sortDirection}
                    onSort={handleSort}
                    style={thStyle}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#6b7280' }}>
                      Loading...
                    </td>
                  </tr>
                ) : sortedRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#6b7280' }}>
                      No data found
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((row) => (
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
