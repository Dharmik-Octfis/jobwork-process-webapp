import { useState, Fragment,useEffect,useMemo } from 'react';
import { format, startOfMonth, startOfDay, endOfDay } from 'date-fns';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Menu, X, Filter, History } from 'lucide-react';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { ItemSearchableSelect } from '../../components/ui/ItemSearchableSelect';
import { ReportDateFilter } from './components/ReportDateFilter';
import { Pagination } from '../../components/ui/Pagination';
import { useListSearch } from '../../hooks/useListSearch';
import { reportsApi } from './reports.api';
import { useQuery } from '@tanstack/react-query';
import { fetchLocations, isOwnLocation } from '../configuration/locations/locations.api';
import type { Item } from '../items/items.schemas';


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
  color: '#4b5563',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  whiteSpace: 'nowrap' as const,
  borderRight: '1px solid #e5e7eb',
  borderBottom: '1px solid #e5e7eb',
};

const tdStyle = {
  padding: '12px 10px',
  fontSize: '13px',
  fontWeight: 500,
  color: '#1f2937',
  whiteSpace: 'normal' as const,
  wordWrap: 'break-word' as const,
  borderRight: '1px solid #e5e7eb',
  borderBottom: '1px solid #e5e7eb',
};

export function FifoCostLotTrackingPage() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();

  const initialState = useMemo(() => {
    if (!orgId) return null;
    const key = `fifoCostLotTrackingState_${orgId}`;
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);

        const safeDate = (val: string | number | null | undefined, fallback: Date) => {
          if (!val) return fallback;
          const d = new Date(val);
          return isNaN(d.getTime()) ? fallback : d;
        };

        parsed.fromDate = parsed.fromDate ? safeDate(parsed.fromDate, startOfMonth(new Date())) : undefined;
        parsed.toDate = parsed.toDate ? safeDate(parsed.toDate, endOfDay(new Date())) : undefined;

        if (parsed.appliedFilters) {
          parsed.appliedFilters.fromDate = parsed.appliedFilters.fromDate ? safeDate(parsed.appliedFilters.fromDate, startOfMonth(new Date())) : undefined;
          parsed.appliedFilters.toDate = parsed.appliedFilters.toDate ? safeDate(parsed.appliedFilters.toDate, endOfDay(new Date())) : undefined;
        }

        return parsed;
      }
    } catch (_e) {
      // ignore parse errors and fallback to default state
    }
    return null;
  }, [orgId]);

  const { page, setPage, perPage, setPerPage } = useListSearch();

  const [dateRangeLabel, setDateRangeLabel] = useState(initialState?.dateRangeLabel || 'This Month');
  const [fromDate, setFromDate] = useState<Date | undefined>(initialState?.fromDate || startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date | undefined>(initialState?.toDate || endOfDay(new Date()));
  const [selectedItem, setSelectedItem] = useState<Item | null>(initialState?.selectedItem || null);
  const [locationId, setLocationId] = useState<string>(initialState?.locationId || '');
  const [isProductOut, setIsProductOut] = useState(initialState?.isProductOut || false);

  const [appliedFilters, setAppliedFilters] = useState(initialState?.appliedFilters || {
    fromDate: startOfMonth(new Date()) as Date | undefined,
    toDate: endOfDay(new Date()) as Date | undefined,
    itemName: undefined as string | undefined,
    locationName: undefined as string | undefined,
    reportBasis: 'product_in' as 'product_in' | 'product_out',
  });

  useEffect(() => {
    if (!orgId) return;
    sessionStorage.setItem(`fifoCostLotTrackingState_${orgId}`, JSON.stringify({
      dateRangeLabel,
      fromDate,
      toDate,
      selectedItem,
      locationId,
      isProductOut,
      appliedFilters
    }));
  }, [dateRangeLabel, fromDate, toDate, selectedItem, locationId, isProductOut, appliedFilters, orgId]);

  const [hasInitializedLoc, setHasInitializedLoc] = useState(false);

  const { data: locations } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId!),
    enabled: !!orgId,
  });

  if (locations && !hasInitializedLoc) {
    const ownLocations = locations.filter(isOwnLocation);
    const defaultLoc = ownLocations.find((l) => l.isPrimary) || ownLocations[0];
    if (defaultLoc && !locationId) {
      setLocationId(defaultLoc.id);
      setAppliedFilters((prev) => ({ ...prev, locationName: defaultLoc.name }));
    }
    setHasInitializedLoc(true);
  }

  const locationOptions =
    locations?.filter(isOwnLocation).map((loc) => ({ label: loc.name, value: loc.id })) || [];

  const locationName = locations?.find((loc) => loc.id === locationId)?.name;

  const { data, isFetching: loading } = useQuery({
    queryKey: [
      'fifoCostLotTracking',
      orgId,
      appliedFilters.fromDate,
      appliedFilters.toDate,
      appliedFilters.itemName,
      appliedFilters.locationName,
      appliedFilters.reportBasis,
      page,
      perPage,
    ],
    queryFn: () =>
      reportsApi.getFifoCostLotTracking(orgId!, {
        reportBasis: appliedFilters.reportBasis,
        fromDate: appliedFilters.fromDate
          ? startOfDay(appliedFilters.fromDate).toISOString()
          : undefined,
        toDate: appliedFilters.toDate ? endOfDay(appliedFilters.toDate).toISOString() : undefined,
        itemName: appliedFilters.itemName,
        locationName: appliedFilters.locationName,
        page,
        perPage,
      }),
    enabled: !!orgId,
  });

  const dataRows = data?.results || [];
  const total = data?.total || 0;

  const leftRowSpans = new Array(dataRows.length).fill(1);
  const skipLeft = new Array(dataRows.length).fill(false);
  const rightRowSpans = new Array(dataRows.length).fill(1);
  const skipRight = new Array(dataRows.length).fill(false);

  const displayOutQty = new Array(dataRows.length).fill(0);
  dataRows.forEach((row, i) => (displayOutQty[i] = row.outQty || 0));

  if (dataRows.length > 0) {
    let leftGroupStart = 0;
    let rightGroupStart = 0;

    for (let i = 1; i < dataRows.length; i++) {
      if (dataRows[i].itemName) {
        leftGroupStart = i;
        rightGroupStart = i;
        continue;
      }

      // Left side grouping
      let isLeftSame = false;
      if (appliedFilters.reportBasis === 'product_out') {
        if (
          dataRows[i].outTransaction &&
          dataRows[i].outTransaction === dataRows[leftGroupStart].outTransaction
        ) {
          isLeftSame = true;
        }
      } else {
        if (
          dataRows[i].inTransaction &&
          dataRows[i].inTransaction === dataRows[leftGroupStart].inTransaction
        ) {
          isLeftSame = true;
        }
      }

      if (isLeftSame) {
        leftRowSpans[leftGroupStart]++;
        skipLeft[i] = true;
        if (appliedFilters.reportBasis === 'product_out') {
          displayOutQty[leftGroupStart] += dataRows[i].outQty || 0;
        }
      } else {
        leftGroupStart = i;
      }

      // Right side grouping
      let isRightSame = false;
      if (appliedFilters.reportBasis === 'product_out') {
        if (
          dataRows[i].inTransaction &&
          dataRows[i].inTransaction === dataRows[rightGroupStart].inTransaction
        ) {
          isRightSame = true;
        }
      } else {
        if (
          dataRows[i].outTransaction &&
          dataRows[i].outTransaction === dataRows[rightGroupStart].outTransaction
        ) {
          isRightSame = true;
        }
      }

      if (isRightSame) {
        rightRowSpans[rightGroupStart]++;
        skipRight[i] = true;
        if (appliedFilters.reportBasis === 'product_in') {
          displayOutQty[rightGroupStart] += dataRows[i].outQty || 0;
        }
      } else {
        rightGroupStart = i;
      }
    }
  }

  const renderDocLink = (docType: string, docId: string, label: string) => {
    if (!docId || !docType || !label) return <span style={{ color: '#2563eb' }}>{label}</span>;
    let url: string;
    switch (docType) {
      case 'bill':
        url = `/organizations/${orgId}/purchases/bills?id=${docId}`;
        break;
      case 'purchase_order':
        url = `/organizations/${orgId}/purchases/purchase-orders?id=${docId}`;
        break;
      case 'job_issue':
        url = `/organizations/${orgId}/jobwork/issues?id=${docId}`;
        break;
      case 'job_receipt':
        url = `/organizations/${orgId}/jobwork/receipts?id=${docId}`;
        break;
      default:
        return <span style={{ color: '#2563eb' }}>{label}</span>;
    }
    return (
      <Link to={url} style={{ color: '#2563eb', textDecoration: 'none' }} title="View Document">
        {label}
      </Link>
    );
  };

  const renderPartyLink = (
    partyId: string | null,
    partyType: 'vendor' | 'customer' | null,
    label: string,
  ) => {
    if (!partyId || !partyType || !label) return <span style={{ color: '#2563eb' }}>{label}</span>;
    let url: string;
    switch (partyType) {
      case 'vendor':
        url = `/organizations/${orgId}/purchases/vendors?id=${partyId}`;
        break;
      case 'customer':
        url = `/organizations/${orgId}/sales/customers?id=${partyId}`;
        break;
      default:
        return <span style={{ color: '#2563eb' }}>{label}</span>;
    }
    return (
      <Link
        to={url}
        style={{ color: '#2563eb', textDecoration: 'none' }}
        title={`View ${partyType}`}
      >
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
                •{' '}
                {appliedFilters.fromDate
                  ? `From ${format(appliedFilters.fromDate, 'dd-MM-yyyy')}`
                  : ''}{' '}
                {appliedFilters.toDate ? `To ${format(appliedFilters.toDate, 'dd-MM-yyyy')}` : ''}
                {!appliedFilters.fromDate && !appliedFilters.toDate && 'All Time'}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{
              ...iconButtonStyle,
              border: 'none',
              color: '#ef4444',
              background: 'transparent',
            }}
          >
            <X size={20} color="#ef4444" />
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '10px 24px',
          background: '#f9fafb',
          borderBottom: '1px solid #e5e7eb',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', width: '100%' }}>
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
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
                color: '#6b7280',
              }}
            >
              <ReportDateFilter
                labelPrefix="Date Range :"
                value={dateRangeLabel}
                isRange={true}
                onChangeRange={(label, start, end) => {
                  setDateRangeLabel(label);
                  setFromDate(start);
                  setToDate(end);
                }}
              />
            </div>

            <ItemSearchableSelect
              orgId={orgId!}
              value={selectedItem?.id}
              onChange={(item) => setSelectedItem(item)}
              keepOpenOnSelect={true}
              showIndicator={!!selectedItem}
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
              keepOpenOnSelect={true}
              showIndicator={!!locationId}
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
              onClick={() =>
                setAppliedFilters({
                  fromDate,
                  toDate,
                  itemName: selectedItem?.name,
                  locationName,
                  reportBasis: isProductOut ? 'product_out' : 'product_in',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="checkbox"
            id="productOutBasis"
            checked={isProductOut}
            onChange={(e) => setIsProductOut(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <label
            htmlFor="productOutBasis"
            style={{ fontSize: '13px', color: '#4b5563', cursor: 'pointer' }}
          >
            Generate the report based on the Product Out transactions for the selected date range
          </label>
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
          <div style={{ textAlign: 'center', padding: '32px 0 24px' }}>
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
              FIFO Cost Lot Tracking
            </h2>
            <div style={{ fontSize: '13px', color: '#4b5563', marginBottom: '4px' }}>
              {appliedFilters.fromDate
                ? `From ${format(appliedFilters.fromDate, 'dd-MM-yyyy')}`
                : ''}{' '}
              {appliedFilters.toDate ? `To ${format(appliedFilters.toDate, 'dd-MM-yyyy')}` : ''}
              {!appliedFilters.fromDate && !appliedFilters.toDate && 'All Time'}
            </div>
            <div
              style={{
                fontSize: '13px',
                color: '#4b5563',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '4px',
                marginBottom: '4px',
              }}
            >
              <History size={12} color="#6b7280" /> {appliedFilters.locationName || 'All Locations'}
            </div>
            <div style={{ fontSize: '13px', color: '#4b5563', marginBottom: '8px' }}>
              Report Generation Basis:
              {appliedFilters.reportBasis === 'product_out' ? 'Product Out' : 'Product In'}
            </div>
            {appliedFilters.itemName && (
              <div style={{ fontSize: '15px', color: '#111827', fontWeight: 500 }}>
                {appliedFilters.itemName}
              </div>
            )}
          </div>

          {/* Data Table */}
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                tableLayout: 'fixed',
                minWidth: '100%',
              }}
            >
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {appliedFilters.reportBasis === 'product_out' ? (
                    <>
                      <th
                        colSpan={4}
                        style={{
                          ...thStyle,
                          textAlign: 'center',
                          borderBottom: '1px solid #e5e7eb',
                          borderRight: '1px solid #e5e7eb',
                        }}
                      >
                        PRODUCT OUT
                      </th>
                      <th
                        colSpan={7}
                        style={{
                          ...thStyle,
                          textAlign: 'center',
                          borderBottom: '1px solid #e5e7eb',
                        }}
                      >
                        PRODUCT IN
                      </th>
                    </>
                  ) : (
                    <>
                      <th
                        colSpan={7}
                        style={{
                          ...thStyle,
                          textAlign: 'center',
                          borderBottom: '1px solid #e5e7eb',
                          borderRight: '1px solid #e5e7eb',
                        }}
                      >
                        PRODUCT IN
                      </th>
                      <th
                        colSpan={4}
                        style={{
                          ...thStyle,
                          textAlign: 'center',
                          borderBottom: '1px solid #e5e7eb',
                        }}
                      >
                        PRODUCT OUT
                      </th>
                    </>
                  )}
                </tr>
                {appliedFilters.reportBasis === 'product_out' ? (
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ ...thStyle }}>DATE</th>
                    <th style={{ ...thStyle }}>TRANSACTIONS</th>
                    <th style={{ ...thStyle }}>DISPERSED TO</th>
                    <th
                      style={{ ...thStyle, textAlign: 'right', borderRight: '1px solid #e5e7eb' }}
                    >
                      QTY DISPERSED
                    </th>

                    <th style={{ ...thStyle }}>DATE</th>
                    <th style={{ ...thStyle }}>TRANSACTIONS</th>
                    <th style={{ ...thStyle }}>RECEIVED FROM</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>QUANTITY</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>AGE</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>COST PER UNIT</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>TOTAL</th>
                  </tr>
                ) : (
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ ...thStyle }}>DATE</th>
                    <th style={{ ...thStyle }}>TRANSACTIONS</th>
                    <th style={{ ...thStyle }}>RECEIVED FROM</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>QUANTITY</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>AGE</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>COST PER UNIT</th>
                    <th
                      style={{ ...thStyle, textAlign: 'right', borderRight: '1px solid #e5e7eb' }}
                    >
                      TOTAL
                    </th>

                    <th style={{ ...thStyle }}>DATE</th>
                    <th style={{ ...thStyle }}>TRANSACTIONS</th>
                    <th style={{ ...thStyle }}>DISPERSED TO</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>QTY DISPERSED</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={11}
                      style={{ ...tdStyle, textAlign: 'center', color: '#6b7280', padding: '24px' }}
                    >
                      Loading...
                    </td>
                  </tr>
                ) : dataRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={11}
                      style={{ ...tdStyle, textAlign: 'center', color: '#6b7280', padding: '24px' }}
                    >
                      No data found
                    </td>
                  </tr>
                ) : (
                  dataRows.map((row, i) => {
                    const isNewItem = !!row.itemName;

                    const inIsLeft = appliedFilters.reportBasis === 'product_in';
                    const inSkip = inIsLeft ? skipLeft[i] : skipRight[i];
                    const inRowSpan = inIsLeft ? leftRowSpans[i] : rightRowSpans[i];

                    const outIsLeft = appliedFilters.reportBasis === 'product_out';
                    const outSkip = outIsLeft ? skipLeft[i] : skipRight[i];
                    const outRowSpan = outIsLeft ? leftRowSpans[i] : rightRowSpans[i];

                    const inCols = inSkip ? null : (
                      <>
                        <td style={{ ...tdStyle, verticalAlign: 'middle' }} rowSpan={inRowSpan}>
                          {row.inDate}
                        </td>
                        <td style={{ ...tdStyle, verticalAlign: 'middle' }} rowSpan={inRowSpan}>
                          {renderDocLink(row.inDocType, row.inDocId, row.inTransaction)}
                        </td>
                        <td style={{ ...tdStyle, verticalAlign: 'middle' }} rowSpan={inRowSpan}>
                          {renderPartyLink(row.inPartyId, row.inPartyType, row.inReceivedFrom)}
                        </td>
                        <td
                          style={{ ...tdStyle, verticalAlign: 'middle', textAlign: 'right' }}
                          rowSpan={inRowSpan}
                        >
                          {row.inQty !== null && row.inQty > 0 ? (
                            <>
                              <div style={{ color: '#111827', fontWeight: 600 }}>{row.inQty}</div>
                              <div style={{ color: '#6b7280', fontSize: '12px' }}>
                                {row.inQtyUnit}
                              </div>
                              {row.inQtyRemaining > 0 && (
                                <div
                                  style={{ color: '#ef4444', fontSize: '12px', marginTop: '2px' }}
                                >
                                  Qty remaining: {row.inQtyRemaining}
                                </div>
                              )}
                            </>
                          ) : null}
                        </td>
                        <td
                          style={{ ...tdStyle, verticalAlign: 'middle', textAlign: 'right' }}
                          rowSpan={inRowSpan}
                        >
                          {row.inAge}
                        </td>
                        <td
                          style={{ ...tdStyle, verticalAlign: 'middle', textAlign: 'right' }}
                          rowSpan={inRowSpan}
                        >
                          {row.inCost}
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            verticalAlign: 'middle',
                            textAlign: 'right',
                            borderRight:
                              appliedFilters.reportBasis === 'product_out'
                                ? undefined
                                : '1px solid #e5e7eb',
                          }}
                          rowSpan={inRowSpan}
                        >
                          {row.inTotal}
                        </td>
                      </>
                    );

                    const outCols = outSkip ? null : (
                      <>
                        <td style={{ ...tdStyle, verticalAlign: 'middle' }} rowSpan={outRowSpan}>
                          {row.outDate}
                        </td>
                        <td style={{ ...tdStyle, verticalAlign: 'middle' }} rowSpan={outRowSpan}>
                          {renderDocLink(row.outDocType, row.outDocId, row.outTransaction)}
                        </td>
                        <td style={{ ...tdStyle, verticalAlign: 'middle' }} rowSpan={outRowSpan}>
                          {renderPartyLink(row.outPartyId, row.outPartyType, row.outDispersedTo)}
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            verticalAlign: 'middle',
                            textAlign: 'right',
                            borderRight:
                              appliedFilters.reportBasis === 'product_out'
                                ? '1px solid #e5e7eb'
                                : undefined,
                          }}
                          rowSpan={outRowSpan}
                        >
                          {row.outQty !== null ? (
                            <>
                              <div style={{ color: '#111827', fontWeight: 600 }}>
                                {Number(displayOutQty[i].toFixed(4))}
                              </div>
                              <div style={{ color: '#6b7280', fontSize: '12px' }}>
                                {row.outQtyUnit}
                              </div>
                            </>
                          ) : null}
                        </td>
                      </>
                    );

                    return (
                      <Fragment key={i}>
                        {isNewItem && !appliedFilters.itemName && (
                          <tr style={{ background: '#f8fafc' }}>
                            <td
                              colSpan={11}
                              style={{
                                padding: '8px 16px',
                                fontWeight: 600,
                                color: '#111827',
                                fontSize: '13px',
                                textAlign: 'left',
                                borderBottom: '1px solid #e5e7eb',
                              }}
                            >
                              Item Name: {row.itemName}
                            </td>
                          </tr>
                        )}
                        <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                          {appliedFilters.reportBasis === 'product_out' ? (
                            <>
                              {outCols}
                              {inCols}
                            </>
                          ) : (
                            <>
                              {inCols}
                              {outCols}
                            </>
                          )}
                        </tr>
                      </Fragment>
                    );
                  })
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
        </div>
      </div>
    </div>
  );
}
