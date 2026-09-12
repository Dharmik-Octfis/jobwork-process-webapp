import { useState } from 'react';
import { format, startOfMonth } from 'date-fns';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Menu, X, Filter, History } from 'lucide-react';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { ItemSearchableSelect } from '../../components/ui/ItemSearchableSelect';
import { ReportDateFilter } from './components/ReportDateFilter';
import { Pagination } from '../../components/ui/Pagination';
import { useListSearch } from '../../hooks/useListSearch';
import { reportsApi } from './reports.api';
import { useQuery } from '@tanstack/react-query';
import { fetchLocations } from '../configuration/locations/locations.api';
import type { Item } from '../items/items.schemas';

export function FifoCostLotTrackingPage() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  
  const { page, setPage, perPage, setPerPage } = useListSearch();

  const [dateRange, setDateRange] = useState('This Month');
  const [fromDate, setFromDate] = useState<Date | undefined>(startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [locationId, setLocationId] = useState<string>('all_locations');

  const { data: locations } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId!),
    enabled: !!orgId,
  });

  const locationOptions = [
    { label: 'All Locations', value: 'all_locations' },
    ...(locations?.map((loc) => ({ label: loc.name, value: loc.id })) || []),
  ];

  const [appliedFilters, setAppliedFilters] = useState<{
    fromDate?: string;
    toDate?: string;
    itemName?: string;
    locationName?: string;
  }>({
    fromDate: startOfMonth(new Date()).toISOString(),
  });

  const { data, isFetching: loading } = useQuery({
    queryKey: ['fifoCostLotTracking', orgId, appliedFilters, page, perPage],
    queryFn: () => reportsApi.getFifoCostLotTracking(orgId!, { ...appliedFilters, page, perPage }),
    enabled: !!orgId,
  });

  const dataRows = data?.results || [];
  const total = data?.total || 0;

  const handleRunReport = () => {
    setAppliedFilters({
      fromDate: fromDate?.toISOString(),
      toDate: toDate?.toISOString(),
      itemName: selectedItem?.name,
      locationName: locationId === 'all_locations' ? undefined : locations?.find((loc) => loc.id === locationId)?.name,
    });
  };

  const renderDocLink = (docType: string, docId: string, label: string) => {
    if (!docId || !docType || !label) return <span style={{ color: '#2563eb' }}>{label}</span>;
    let url: string;
    switch (docType) {
      case 'bill': url = `/organizations/${orgId}/purchases/bills?id=${docId}`; break;
      case 'purchase_order': url = `/organizations/${orgId}/purchases/purchase-orders?id=${docId}`; break;
      case 'job_issue': url = `/organizations/${orgId}/jobwork/issues?id=${docId}`; break;
      case 'job_receipt': url = `/organizations/${orgId}/jobwork/receipts?id=${docId}`; break;
      default: return <span style={{ color: '#2563eb' }}>{label}</span>;
    }
    return (
      <Link to={url} style={{ color: '#2563eb', textDecoration: 'none' }} title="View Document">
        {label}
      </Link>
    );
  };

  const renderPartyLink = (partyId: string | null, partyType: 'vendor' | 'customer' | null, label: string) => {
    if (!partyId || !partyType || !label) return <span style={{ color: '#2563eb' }}>{label}</span>;
    let url: string;
    switch (partyType) {
      case 'vendor': url = `/organizations/${orgId}/purchases/vendors?id=${partyId}`; break;
      case 'customer': url = `/organizations/${orgId}/sales/customers?id=${partyId}`; break;
      default: return <span style={{ color: '#2563eb' }}>{label}</span>;
    }
    return (
      <Link to={url} style={{ color: '#2563eb', textDecoration: 'none' }} title={`View ${partyType}`}>
        {label}
      </Link>
    );
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
              FIFO Cost Lot Tracking
              <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: '6px' }}>
                • {fromDate ? `From ${format(fromDate, 'dd-MM-yyyy')}` : ''} {toDate ? `To ${format(toDate, 'dd-MM-yyyy')}` : ''}
                {!fromDate && !toDate && 'All Time'}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{ ...iconButtonStyle, border: 'none', color: '#ef4444', background: 'transparent' }}
          >
            <X size={20} color="#ef4444" />
          </button>
        </div>
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
          <ReportDateFilter
            value={dateRange}
            onChange={(label, date) => {
              setDateRange(label);
              setFromDate(date);
              setToDate(undefined);
            }}
          />

          <ItemSearchableSelect
            orgId={orgId!}
            value={selectedItem?.id}
            onChange={(item) => setSelectedItem(item)}
            placeholder="Item Name : All Items"
            renderValue={(item) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#6b7280' }}>Item Name :</span>
                <span style={{ color: '#111827', fontWeight: 500 }}>
                  {item ? item.name : 'All Items'}
                </span>
              </div>
            )}
            triggerStyle={filterTriggerStyle}
            style={{ width: 'max-content', minWidth: '220px' }}
            dropdownWidth={300}
          />

          <SearchableSelect
            options={locationOptions}
            value={locationId}
            onChange={setLocationId}
            style={{ width: 'max-content' }}
            triggerStyle={filterTriggerStyle}
            renderValue={(opt) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#6b7280' }}>Location Name :</span>
                <span style={{ color: '#111827', fontWeight: 500 }}>{opt?.label}</span>
              </div>
            )}
          />

          <button
            type="button"
            onClick={handleRunReport}
            style={{
              background: '#059669',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '6px 16px',
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
          {/* Report Header Text */}
          <div style={{ textAlign: 'center', padding: '32px 0 24px' }}>
            <div style={{ fontSize: '13px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', fontWeight: 500 }}>
              OCTFIS TECHNO llp
            </div>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#111827', margin: '0 0 8px 0' }}>
              FIFO Cost Lot Tracking
            </h2>
            <div style={{ fontSize: '13px', color: '#4b5563', marginBottom: '4px' }}>
              {fromDate ? `From ${format(fromDate, 'dd-MM-yyyy')}` : ''} {toDate ? `To ${format(toDate, 'dd-MM-yyyy')}` : ''}
              {!fromDate && !toDate && 'All Time'}
            </div>
            <div style={{ fontSize: '13px', color: '#4b5563', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
              <History size={12} color="#6b7280" /> Head Office
            </div>
            <div style={{ fontSize: '13px', color: '#4b5563', marginBottom: '8px' }}>Report Generation Basis:Product In</div>
            <div style={{ fontSize: '15px', color: '#111827', fontWeight: 500 }}>Item Name</div>
          </div>

          {/* Data Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: '100%' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th colSpan={7} style={{ ...thStyle, textAlign: 'center', borderBottom: '1px solid #e5e7eb', borderRight: '1px solid #e5e7eb' }}>
                    PRODUCT IN
                  </th>
                  <th colSpan={4} style={{ ...thStyle, textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>
                    PRODUCT OUT
                  </th>
                </tr>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ ...thStyle }}>DATE</th>
                  <th style={{ ...thStyle }}>TRANSACTIONS</th>
                  <th style={{ ...thStyle }}>RECEIVED FROM</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>QUANTITY</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>AGE</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>COST PER UNIT</th>
                  <th style={{ ...thStyle, textAlign: 'right', borderRight: '1px solid #e5e7eb' }}>TOTAL</th>

                  <th style={{ ...thStyle }}>DATE</th>
                  <th style={{ ...thStyle }}>TRANSACTIONS</th>
                  <th style={{ ...thStyle }}>DISPERSED TO</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>QTY DISPERSED</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={11} style={{ ...tdStyle, textAlign: 'center', color: '#6b7280', padding: '24px' }}>
                      Loading...
                    </td>
                  </tr>
                ) : dataRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ ...tdStyle, textAlign: 'center', color: '#6b7280', padding: '24px' }}>
                      No data found
                    </td>
                  </tr>
                ) : (
                  dataRows.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ ...tdStyle, verticalAlign: 'top' }}>{row.inDate}</td>
                      <td style={{ ...tdStyle, verticalAlign: 'top' }}>
                        {renderDocLink(row.inDocType, row.inDocId, row.inTransaction)}
                      </td>
                      <td style={{ ...tdStyle, verticalAlign: 'top' }}>
                        {renderPartyLink(row.inPartyId, row.inPartyType, row.inReceivedFrom)}
                      </td>
                      <td style={{ ...tdStyle, verticalAlign: 'top', textAlign: 'right' }}>
                        {row.inQty > 0 ? (
                          <>
                            <div style={{ color: '#111827', fontWeight: 500 }}>{row.inQty}</div>
                            <div style={{ color: '#6b7280', fontSize: '12px' }}>{row.inQtyUnit}</div>
                            {row.inQtyRemaining > 0 && (
                              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '2px' }}>Qty remaining: {row.inQtyRemaining}</div>
                            )}
                          </>
                        ) : null}
                      </td>
                      <td style={{ ...tdStyle, verticalAlign: 'top', textAlign: 'right' }}>{row.inAge}</td>
                      <td style={{ ...tdStyle, verticalAlign: 'top', textAlign: 'right' }}>{row.inCost}</td>
                      <td style={{ ...tdStyle, verticalAlign: 'top', textAlign: 'right', borderRight: '1px solid #e5e7eb' }}>{row.inTotal}</td>

                      <td style={{ ...tdStyle, verticalAlign: 'top' }}>{row.outDate}</td>
                      <td style={{ ...tdStyle, verticalAlign: 'top' }}>
                        {renderDocLink(row.outDocType, row.outDocId, row.outTransaction)}
                      </td>
                      <td style={{ ...tdStyle, verticalAlign: 'top' }}>
                        {renderPartyLink(row.outPartyId, row.outPartyType, row.outDispersedTo)}
                      </td>
                      <td style={{ ...tdStyle, verticalAlign: 'top', textAlign: 'right' }}>
                        {row.outQty !== null ? (
                          <>
                            <div style={{ color: '#111827', fontWeight: 500 }}>{row.outQty}</div>
                            <div style={{ color: '#6b7280', fontSize: '12px' }}>{row.outQtyUnit}</div>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

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

          <div style={{ padding: '16px 24px', fontSize: '12px', color: '#4b5563', borderTop: '1px solid #e5e7eb' }}>
            **Amount is displayed in your base currency <span style={{ background: '#16a34a', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 500, fontSize: '11px', marginLeft: '4px' }}>INR</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const iconButtonStyle = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: '4px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '6px',
  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
};

const filterTriggerStyle = {
  display: 'flex',
  alignItems: 'center',
  border: '1px solid #d1d5db',
  background: '#fff',
  padding: '4px 10px',
  borderRadius: '6px',
  fontSize: '12px',
  height: 'auto',
  minHeight: '0',
  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
  cursor: 'pointer',
};

const thStyle = {
  padding: '12px 10px',
  textAlign: 'left' as const,
  fontSize: '11px',
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  whiteSpace: 'nowrap' as const,
  borderRight: '1px solid #e5e7eb',
};

const tdStyle = {
  padding: '12px 10px',
  fontSize: '13px',
  color: '#111827',
  whiteSpace: 'normal' as const,
  wordWrap: 'break-word' as const,
  borderRight: '1px solid #e5e7eb',
};
