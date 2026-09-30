import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchPurchaseOrders,
  fetchPurchaseOrderCount,
  deletePurchaseOrder,
} from './purchase-orders.api';
import { fetchPaymentTerms, type PaymentTerm } from './payment-terms.api';
import {
  Plus,
  SlidersHorizontal,
  FileText,
  Search,
  MoreHorizontal,
  RotateCw,
  Settings,
  Layers,
  CheckCircle2,
  Clock,
  Send,
  ShoppingCart,
} from 'lucide-react';
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useState, useRef, useEffect, useMemo } from 'react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { PurchaseOrderDetail } from './PurchaseOrderDetail';
import { Pagination } from '../../../components/ui/Pagination';
import { useListSearch } from '../../../hooks/useListSearch';
import { useListCount } from '../../../hooks/useListCount';
import { useListColumns } from '../../../hooks/useListColumns';
import { CustomizeColumnsModal } from '../../../components/ui/CustomizeColumnsModal';
import { ListFilterDropdown } from '../../../components/ui/ListFilterDropdown';
import { BulkActionBar } from '../../../components/ui/BulkActionBar';
import { format } from 'date-fns';
import { CUSTOM_FIELD_PREFIX } from '../../list-views/listViews.api';
import { PurchaseOrderStatusBadge } from './PurchaseOrderStatusBadge';
import type { PurchaseOrder } from './purchase-orders.schemas';
import { useActiveCustomFields } from '../../custom-fields/customFields.api';
import type { CustomFieldDefinition } from '../../custom-fields/customFields.schemas';

function formatDate(val: unknown): string {
  if (!val) return '-';
  try {
    const d = new Date(String(val));
    if (isNaN(d.getTime())) return '-';
    return format(d, 'dd-MM-yyyy');
  } catch {
    return String(val);
  }
}

function getVendorInitials(name?: string): string {
  if (!name) return 'PO';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = [
  { bg: '#e0f2fe', text: '#0284c7' },
  { bg: '#fef3c7', text: '#b45309' },
  { bg: '#dcfce7', text: '#15803d' },
  { bg: '#f3e8ff', text: '#7e22ce' },
  { bg: '#ffe4e6', text: '#be123c' },
  { bg: '#ffedd5', text: '#c2410c' },
  { bg: '#f1f5f9', text: '#475569' },
];

function getAvatarColor(name?: string) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function renderPoCell(
  po: PurchaseOrder,
  key: string,
  paymentTerms: PaymentTerm[] = [],
  customFieldsDef?: CustomFieldDefinition[],
): React.ReactNode {
  if (key === 'status') {
    return <PurchaseOrderStatusBadge status={po.status} />;
  }

  if (key === 'poNumber') {
    return (
      <span
        style={{
          fontWeight: 600,
          color: '#0284c7',
        }}
      >
        {po.poNumber || '-'}
      </span>
    );
  }

  if (key === 'vendor' || key === 'vendorName') {
    const vendorName = po.vendor?.contactName || po.vendor?.companyName || '-';
    const subText =
      po.vendor?.contactName &&
      po.vendor?.companyName &&
      po.vendor.contactName !== po.vendor.companyName
        ? po.vendor.companyName
        : null;
    const initials = getVendorInitials(vendorName);
    const color = getAvatarColor(vendorName);

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: color.bg,
            color: color.text,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 11,
            flexShrink: 0,
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          }}
        >
          {initials}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: 500,
              color: '#1e293b',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {vendorName}
          </div>
          {subText && (
            <div
              style={{
                fontSize: 11,
                color: '#64748b',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {subText}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (key === 'billed' || key === 'billedStatus') {
    const isBilled = Boolean(po.bills && po.bills.length > 0);
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <span
          title={isBilled ? 'Billed' : 'Unbilled'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 600,
            background: isBilled ? '#ecfdf5' : '#f8fafc',
            color: isBilled ? '#059669' : '#64748b',
            border: `1px solid ${isBilled ? '#a7f3d0' : '#e2e8f0'}`,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: isBilled ? '#10b981' : '#94a3b8',
            }}
          />
          {isBilled ? 'Billed' : 'Unbilled'}
        </span>
      </div>
    );
  }

  if (key === 'received' || key === 'receivedStatus') {
    const norm = (po.status || '').toLowerCase().trim();
    const isReceived = ['closed', 'completed', 'received'].includes(norm);
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <span
          title={isReceived ? 'Received' : 'Not Received'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 600,
            background: isReceived ? '#f0f9ff' : '#f8fafc',
            color: isReceived ? '#0284c7' : '#64748b',
            border: `1px solid ${isReceived ? '#bae6fd' : '#e2e8f0'}`,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: isReceived ? '#0284c7' : '#94a3b8',
            }}
          />
          {isReceived ? 'Received' : 'Pending'}
        </span>
      </div>
    );
  }

  if (key === 'totalAmount' || key === 'total' || key === 'amount') {
    const amt = Number((po as Record<string, unknown>).total || po.totalAmount || 0);
    return (
      <span style={{ fontWeight: 600, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
        ₹{amt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    );
  }

  if (key === 'paymentTerms') {
    const term = paymentTerms.find((t) => t.id === po.paymentTerms);
    return term ? term.termName : po.paymentTerms || '-';
  }

  if (key.startsWith(CUSTOM_FIELD_PREFIX)) {
    const cfKey = key.slice(CUSTOM_FIELD_PREFIX.length);
    const value = po.customFields?.[cfKey];
    if (value === null || value === undefined || value === '') return '-';

    const def = customFieldsDef?.find((d) => d.key === cfKey);
    if (def) {
      if (def.dataType === 'select' || def.dataType === 'multi_select') {
        const options = def.config?.options || [];
        if (Array.isArray(value)) {
          return value.map((v) => options.find((o) => o.id === v)?.label || v).join(', ');
        }
        return options.find((o) => o.id === value)?.label || String(value);
      }

      if (['date', 'datetime', 'time'].includes(def.dataType)) {
        return formatDate(String(value));
      }
    }

    return Array.isArray(value) ? value.join(', ') : String(value);
  }

  if (key === 'location') {
    return (
      po.deliveryLocation?.name ||
      ((po as unknown as Record<string, unknown>).location as { name?: string })?.name ||
      po.deliveryType ||
      '-'
    );
  }

  if (key === 'referenceNumber') {
    return (
      po.referenceNumber ||
      ((po.customFields as Record<string, unknown>)?.referenceNumber as string) ||
      ((po.customFields as Record<string, unknown>)?.reference as string) ||
      '-'
    );
  }

  if (key === 'companyName') {
    return (
      po.vendor?.companyName ||
      ((po.customFields as Record<string, unknown>)?.companyName as string) ||
      '-'
    );
  }

  if (key === 'expectedDeliveryDate' || key === 'deliveryDate') {
    return formatDate(
      po.deliveryDate || (po.customFields as Record<string, unknown>)?.expectedDeliveryDate,
    );
  }

  if (key === 'vendor' || key === 'vendorName') {
    return po.vendor?.contactName || '-';
  }

  if (key === 'date' || key === 'createdAt' || key === 'updatedAt') {
    return formatDate((po as unknown as Record<string, unknown>)[key]);
  }

  const value = (po as unknown as Record<string, unknown>)[key];
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

export function PurchaseOrdersList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedPoId = searchParams.get('id');

  const { search, filter, setFilter, perPage, setPerPage, page, setPage } = useListSearch();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['purchaseOrders', orgId, search, filter, page, perPage],
    queryFn: () =>
      fetchPurchaseOrders(orgId!, { search: search || undefined, filter, page, perPage }),
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
  });

  const { data: paymentTerms = [] } = useQuery({
    queryKey: ['paymentTerms', orgId],
    queryFn: () => fetchPaymentTerms(orgId!),
    enabled: Boolean(orgId),
  });

  const { data: customFieldsDef } = useActiveCustomFields(orgId, 'purchase_order');

  const results = data?.results;
  const pageContext = data?.pageContext;
  const purchaseOrders = useMemo(() => results ?? [], [results]);

  const {
    total,
    isCounting,
    request: requestCount,
  } = useListCount(['purchaseOrders-count', orgId, search, filter], () =>
    fetchPurchaseOrderCount(orgId!, { search: search || undefined, filter }),
  );

  const { catalog, visible, filters, columns, save } = useListColumns(orgId, 'purchase_order');
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);

  const queryClient = useQueryClient();
  const [poToDelete, setPoToDelete] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);

  // More menu state
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [showRefreshToast, setShowRefreshToast] = useState(false);

  // Close more menu on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Compute summary stats for the Executive KPI ribbon
  const stats = useMemo(() => {
    let totalAmt = 0;
    let drafts = 0;
    let issued = 0;
    let approved = 0;

    for (const po of purchaseOrders) {
      totalAmt += Number((po as Record<string, unknown>).total || po.totalAmount || 0);
      const st = (po.status || '').toLowerCase();
      if (st === 'draft') drafts++;
      else if (st === 'issued' || st === 'sent') issued++;
      else if (st === 'approved' || st === 'closed' || st === 'completed') approved++;
    }

    return {
      totalAmt,
      drafts,
      issued,
      approved,
      count: total ?? purchaseOrders.length,
    };
  }, [purchaseOrders, total]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePurchaseOrder(orgId!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders', orgId] });
      setPoToDelete(null);
    },
  });

  const handleDeleteSelected = async () => {
    setIsBulkDeleteDialogOpen(true);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const toggleAll = () => {
    if (selectedIds.length === purchaseOrders.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(purchaseOrders.map((i) => i.id));
    }
  };

  const handleRefresh = () => {
    setIsMoreMenuOpen(false);
    queryClient.invalidateQueries({ queryKey: ['purchaseOrders', orgId] });
    setShowRefreshToast(true);
    setTimeout(() => setShowRefreshToast(false), 2500);
  };

  const headerStyle: React.CSSProperties = {
    padding: '12px 16px',
    fontWeight: 600,
    fontSize: 11.5,
    color: '#475569',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  };

  // Status quick filter options
  const STATUS_TABS = [
    { key: 'all', label: 'All Orders' },
    { key: 'draft', label: 'Draft' },
    { key: 'issued', label: 'Issued' },
    { key: 'approved', label: 'Approved' },
    { key: 'closed', label: 'Closed' },
  ];

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        className={`master-detail-container ${selectedPoId ? 'has-selection' : ''}`}
        style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#f8fafc' }}
      >
        <div
          className="master-pane"
          style={{
            flex: selectedPoId ? '0 0 340px' : 1,
            borderRight: selectedPoId ? '1px solid #eef0f3' : 'none',
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
          }}
        >
          {!selectedPoId && selectedIds.length > 0 ? (
            <BulkActionBar
              selectedCount={selectedIds.length}
              onClearSelection={() => setSelectedIds([])}
              onDelete={handleDeleteSelected}
              isProcessing={isProcessing}
            />
          ) : (
            <header
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: selectedPoId ? '12px 16px' : '16px 24px',
                background: '#fff',
                borderBottom: '1px solid #e2e8f0',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                <ListFilterDropdown
                  filters={filters}
                  value={filter}
                  onChange={setFilter}
                  fallbackLabel="All Purchase Orders"
                />
                {!selectedPoId && total !== null && total !== undefined && (
                  <span
                    style={{
                      background: '#f1f5f9',
                      color: '#475569',
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 12,
                    }}
                  >
                    {total}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                {/* Search Bar on Header (Full view only) */}
                {!selectedPoId && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 6,
                      padding: '0 10px',
                      height: 34,
                      width: 200,
                      transition: 'all 0.15s ease',
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = '#0284c7';
                      e.currentTarget.style.boxShadow = '0 0 0 2px rgba(2, 132, 199, 0.15)';
                      e.currentTarget.style.background = '#fff';
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = '#e2e8f0';
                      e.currentTarget.style.boxShadow = 'none';
                      e.currentTarget.style.background = '#f8fafc';
                    }}
                  >
                    <Search size={14} color="#94a3b8" />
                    <input
                      type="text"
                      placeholder="Search orders..."
                      defaultValue={search}
                      onChange={(e) => {
                        const val = e.target.value;
                        const timeout = setTimeout(() => {
                          const params = new URLSearchParams(location.search);
                          if (val.trim()) params.set('search', val.trim());
                          else params.delete('search');
                          navigate({ search: params.toString() }, { replace: true });
                        }, 300);
                        return () => clearTimeout(timeout);
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        outline: 'none',
                        fontSize: 12,
                        paddingLeft: 8,
                        width: '100%',
                        color: '#1e293b',
                      }}
                    />
                  </div>
                )}

                {/* + New Button */}
                {!selectedPoId ? (
                  <button
                    onClick={() =>
                      navigate(`/organizations/${orgId}/purchases/purchase-orders/new`, {
                        state: { returnUrl: location.pathname + location.search },
                      })
                    }
                    style={{
                      background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                      color: 'white',
                      border: 'none',
                      padding: '7px 14px',
                      borderRadius: '6px',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      whiteSpace: 'nowrap',
                      boxShadow: '0 2px 6px rgba(2, 132, 199, 0.25)',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = '0 4px 10px rgba(2, 132, 199, 0.35)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = '0 2px 6px rgba(2, 132, 199, 0.25)';
                      e.currentTarget.style.transform = 'none';
                    }}
                  >
                    <Plus size={16} /> New PO
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      navigate(`/organizations/${orgId}/purchases/purchase-orders/new`, {
                        state: { returnUrl: location.pathname + location.search },
                      })
                    }
                    title="New Purchase Order"
                    style={{
                      background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                      color: 'white',
                      border: 'none',
                      width: 32,
                      height: 32,
                      borderRadius: '6px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 6px rgba(2, 132, 199, 0.25)',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = '0 4px 10px rgba(2, 132, 199, 0.35)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = '0 2px 6px rgba(2, 132, 199, 0.25)';
                      e.currentTarget.style.transform = 'none';
                    }}
                  >
                    <Plus size={16} />
                  </button>
                )}

                {/* More Options Dropdown */}
                <div ref={moreMenuRef} style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => setIsMoreMenuOpen((v) => !v)}
                    title="More Options"
                    aria-label="More Options"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      border: '1px solid #e2e8f0',
                      background: isMoreMenuOpen ? '#f1f5f9' : '#fff',
                      color: '#475569',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f8fafc';
                      e.currentTarget.style.color = '#0284c7';
                    }}
                    onMouseLeave={(e) => {
                      if (!isMoreMenuOpen) {
                        e.currentTarget.style.background = '#fff';
                        e.currentTarget.style.color = '#475569';
                      }
                    }}
                  >
                    <MoreHorizontal size={16} />
                  </button>

                  {isMoreMenuOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: '100%',
                        marginTop: 6,
                        width: 210,
                        background: '#fff',
                        borderRadius: 8,
                        boxShadow:
                          '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.05)',
                        border: '1px solid #e2e8f0',
                        padding: '6px 0',
                        zIndex: 100,
                      }}
                    >
                      {/* Customize Columns */}
                      <div
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          setIsColumnsOpen(true);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 16px',
                          fontSize: 13,
                          color: '#1e293b',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <SlidersHorizontal size={15} color="#0284c7" />
                        <span>Customize Columns</span>
                      </div>

                      {/* Manage Custom Fields */}
                      <div
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          navigate(
                            `/organizations/${orgId}/settings/custom-fields?module=purchase_order`,
                          );
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 16px',
                          fontSize: 13,
                          color: '#1e293b',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <Layers size={15} color="#0284c7" />
                        <span>Custom Fields</span>
                      </div>

                      {/* Preferences */}
                      <div
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          navigate(`/organizations/${orgId}/settings/preferences`);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 16px',
                          fontSize: 13,
                          color: '#1e293b',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <Settings size={15} color="#0284c7" />
                        <span>Preferences</span>
                      </div>

                      <div style={{ height: 1, background: '#f1f5f9', margin: '4px 0' }} />

                      {/* Refresh */}
                      <div
                        onClick={handleRefresh}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 16px',
                          fontSize: 13,
                          color: '#1e293b',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <RotateCw size={15} color="#0284c7" />
                        <span>Refresh List</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </header>
          )}

          {/* Executive KPI Metric Ribbon (UI 2 Feature - when no PO selected) */}
          {!selectedPoId && purchaseOrders.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 12,
                padding: '16px 24px',
                background: '#f8fafc',
                borderBottom: '1px solid #e2e8f0',
              }}
            >
              {/* Card 1: Total Orders */}
              <div
                onClick={() => setFilter('all')}
                style={{
                  background: '#fff',
                  border: filter === 'all' ? '1.5px solid #0284c7' : '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#0284c7')}
                onMouseLeave={(e) => {
                  if (filter !== 'all') e.currentTarget.style.borderColor = '#e2e8f0';
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 8,
                    background: '#e0f2fe',
                    color: '#0284c7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <ShoppingCart size={19} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Total Orders
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                      {stats.count}
                    </span>
                    <span style={{ fontSize: 12, color: '#0284c7', fontWeight: 600 }}>
                      ₹{stats.totalAmt.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 2: Draft Orders */}
              <div
                onClick={() => setFilter('draft')}
                style={{
                  background: '#fff',
                  border: filter === 'draft' ? '1.5px solid #d97706' : '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#d97706')}
                onMouseLeave={(e) => {
                  if (filter !== 'draft') e.currentTarget.style.borderColor = '#e2e8f0';
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 8,
                    background: '#fef3c7',
                    color: '#d97706',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Clock size={19} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Drafts
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                      {stats.drafts}
                    </span>
                    <span style={{ fontSize: 11, color: '#b45309' }}>Awaiting issue</span>
                  </div>
                </div>
              </div>

              {/* Card 3: Issued Orders */}
              <div
                onClick={() => setFilter('issued')}
                style={{
                  background: '#fff',
                  border: filter === 'issued' ? '1.5px solid #0284c7' : '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#0284c7')}
                onMouseLeave={(e) => {
                  if (filter !== 'issued') e.currentTarget.style.borderColor = '#e2e8f0';
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 8,
                    background: '#e0f2fe',
                    color: '#0284c7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Send size={19} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Issued
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                      {stats.issued}
                    </span>
                    <span style={{ fontSize: 11, color: '#0284c7' }}>With vendors</span>
                  </div>
                </div>
              </div>

              {/* Card 4: Approved & Closed */}
              <div
                onClick={() => setFilter('approved')}
                style={{
                  background: '#fff',
                  border: filter === 'approved' ? '1.5px solid #16a34a' : '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#16a34a')}
                onMouseLeave={(e) => {
                  if (filter !== 'approved') e.currentTarget.style.borderColor = '#e2e8f0';
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 8,
                    background: '#dcfce7',
                    color: '#16a34a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <CheckCircle2 size={19} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Approved & Closed
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                      {stats.approved}
                    </span>
                    <span style={{ fontSize: 11, color: '#16a34a' }}>Fulfilled</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Status Tab Pills Bar (Full view only) */}
          {!selectedPoId && purchaseOrders.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 24px',
                background: '#fff',
                borderBottom: '1px solid #f1f5f9',
                overflowX: 'auto',
              }}
            >
              {STATUS_TABS.map((tab) => {
                const isActive = filter === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setFilter(tab.key)}
                    style={{
                      background: isActive ? '#0284c7' : '#f8fafc',
                      color: isActive ? '#fff' : '#64748b',
                      border: `1px solid ${isActive ? '#0284c7' : '#e2e8f0'}`,
                      borderRadius: 20,
                      padding: '4px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = '#f1f5f9';
                        e.currentTarget.style.color = '#1e293b';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = '#f8fafc';
                        e.currentTarget.style.color = '#64748b';
                      }
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: '48px', textAlign: 'center', color: '#64748b' }}>
                <RotateCw
                  size={24}
                  style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }}
                />
                <div>Loading purchase orders...</div>
              </div>
            ) : isError ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#ef4444' }}>
                Error loading purchase orders. Please try again.
              </div>
            ) : purchaseOrders.length === 0 ? (
              <div
                style={{
                  padding: '64px 32px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: '50%',
                    background: '#f0f9ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '16px',
                  }}
                >
                  <FileText size={36} color="#0284c7" />
                </div>
                <h2
                  style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px 0' }}
                >
                  No Purchase Orders Found
                </h2>
                <p
                  style={{
                    color: '#64748b',
                    maxWidth: 400,
                    margin: '0 0 20px 0',
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  {search
                    ? `No purchase orders match "${search}". Try clearing search filters.`
                    : 'Create your first purchase order to track vendor procurement, pricing, and receipts.'}
                </p>
                <button
                  onClick={() =>
                    navigate(`/organizations/${orgId}/purchases/purchase-orders/new`, {
                      state: { returnUrl: location.pathname + location.search },
                    })
                  }
                  style={{
                    background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                    color: 'white',
                    border: 'none',
                    padding: '8px 20px',
                    borderRadius: '6px',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: 'pointer',
                    boxShadow: '0 2px 6px rgba(2, 132, 199, 0.25)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  Create Purchase Order
                </button>
              </div>
            ) : (
              <div>
                {selectedPoId ? (
                  /* Master List in Split-View Mode */
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div
                      style={{
                        padding: '10px 16px',
                        fontSize: '11px',
                        fontWeight: 700,
                        color: '#64748b',
                        background: '#f8fafc',
                        borderBottom: '1px solid #e2e8f0',
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>
                        {filters.find((f) => f.key === filter)?.label ?? 'All Purchase Orders'}
                      </span>
                      <span style={{ fontWeight: 600, color: '#94a3b8' }}>
                        {purchaseOrders.length}
                      </span>
                    </div>
                    {purchaseOrders.map((po) => {
                      const isSelected = selectedPoId === po.id;
                      const vendorName = po.vendor?.contactName || po.vendor?.companyName || '-';
                      const initials = getVendorInitials(vendorName);
                      const color = getAvatarColor(vendorName);

                      return (
                        <div
                          key={po.id}
                          onClick={() => setSearchParams({ id: po.id })}
                          style={{
                            padding: '12px 14px',
                            borderBottom: '1px solid #f1f5f9',
                            cursor: 'pointer',
                            background: isSelected ? '#f0f9ff' : 'transparent',
                            borderLeft: isSelected ? '3px solid #0284c7' : '3px solid transparent',
                            transition: 'all 0.12s ease',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 10,
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) e.currentTarget.style.background = '#f8fafc';
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(po.id)}
                            onChange={(e) => {
                              e.stopPropagation();
                              toggleSelection(po.id);
                            }}
                            style={{ marginTop: 3, cursor: 'pointer', accentColor: '#0284c7' }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: 4,
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  minWidth: 0,
                                }}
                              >
                                <div
                                  style={{
                                    width: 22,
                                    height: 22,
                                    borderRadius: '50%',
                                    background: color.bg,
                                    color: color.text,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 700,
                                    fontSize: 10,
                                    flexShrink: 0,
                                  }}
                                >
                                  {initials}
                                </div>
                                <span
                                  style={{
                                    fontWeight: 600,
                                    fontSize: 13,
                                    color: '#0f172a',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {vendorName}
                                </span>
                              </div>
                              <span
                                style={{
                                  fontWeight: 700,
                                  fontSize: 13,
                                  color: '#0f172a',
                                  marginLeft: 6,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                ₹
                                {Number(po.totalAmount || 0).toLocaleString('en-IN', {
                                  maximumFractionDigits: 0,
                                })}
                              </span>
                            </div>

                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                fontSize: 12,
                                color: '#64748b',
                              }}
                            >
                              <span>
                                <span style={{ fontWeight: 600, color: '#0284c7' }}>
                                  {po.poNumber}
                                </span>{' '}
                                • {formatDate(po.date)}
                              </span>
                              <PurchaseOrderStatusBadge status={po.status} size="sm" />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Modern Full Table View */
                  <div
                    className="responsive-table-wrapper"
                    style={{ overflowX: 'auto', width: '100%' }}
                  >
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr
                          style={{
                            background: '#f8fafc',
                            borderTop: '1px solid #e2e8f0',
                            borderBottom: '1px solid #e2e8f0',
                          }}
                        >
                          <th
                            style={{
                              width: 52,
                              ...headerStyle,
                              padding: '12px 10px',
                              textAlign: 'center',
                              verticalAlign: 'middle',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 6,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => setIsColumnsOpen(true)}
                                title="Customize Columns"
                                aria-label="Customize Columns"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  background: 'none',
                                  border: 'none',
                                  padding: 2,
                                  cursor: 'pointer',
                                  color: '#64748b',
                                  borderRadius: 4,
                                  transition: 'color 0.15s ease',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = '#0284c7')}
                                onMouseLeave={(e) => (e.currentTarget.style.color = '#64748b')}
                              >
                                <SlidersHorizontal size={14} />
                              </button>
                              <input
                                type="checkbox"
                                checked={
                                  purchaseOrders.length > 0 &&
                                  selectedIds.length === purchaseOrders.length
                                }
                                onChange={toggleAll}
                                style={{ cursor: 'pointer', accentColor: '#0284c7' }}
                              />
                            </div>
                          </th>
                          {columns.map((col) => {
                            const isCenter =
                              col.key === 'billed' ||
                              col.key === 'received' ||
                              col.key === 'billedStatus';
                            const isRight =
                              col.key === 'total' ||
                              col.key === 'amount' ||
                              col.key === 'totalAmount';
                            return (
                              <th
                                key={col.key}
                                style={{
                                  ...headerStyle,
                                  textAlign: isRight ? 'right' : isCenter ? 'center' : 'left',
                                  width: isCenter ? 95 : undefined,
                                }}
                              >
                                <span>{col.label}</span>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {purchaseOrders.map((po) => {
                          const isChecked = selectedIds.includes(po.id);
                          return (
                            <tr
                              key={po.id}
                              onClick={() => setSearchParams({ id: po.id })}
                              style={{
                                borderBottom: '1px solid #f1f5f9',
                                transition: 'all 0.12s ease',
                                cursor: 'pointer',
                                background: isChecked ? '#f0f9ff' : 'transparent',
                              }}
                              onMouseEnter={(e) => {
                                if (!isChecked) e.currentTarget.style.background = '#f8fafc';
                              }}
                              onMouseLeave={(e) => {
                                if (!isChecked) e.currentTarget.style.background = 'transparent';
                              }}
                            >
                              <td
                                style={{
                                  width: 52,
                                  padding: '12px 10px',
                                  textAlign: 'center',
                                  verticalAlign: 'middle',
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleSelection(po.id)}
                                  style={{ cursor: 'pointer', accentColor: '#0284c7' }}
                                />
                              </td>
                              {columns.map((col) => {
                                const isCenter =
                                  col.key === 'billed' ||
                                  col.key === 'received' ||
                                  col.key === 'billedStatus';
                                const isRight =
                                  col.key === 'total' ||
                                  col.key === 'amount' ||
                                  col.key === 'totalAmount';
                                return (
                                  <td
                                    key={col.key}
                                    style={{
                                      padding: '12px 16px',
                                      color: col.key === 'poNumber' ? '#0284c7' : '#334155',
                                      fontSize: 13,
                                      fontWeight: col.key === 'poNumber' ? 600 : 400,
                                      textAlign: isRight ? 'right' : isCenter ? 'center' : 'left',
                                    }}
                                  >
                                    {col.key === 'status' ? (
                                      <PurchaseOrderStatusBadge
                                        status={po.status}
                                        variant="badge"
                                      />
                                    ) : (
                                      renderPoCell(po, col.key, paymentTerms, customFieldsDef)
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Pagination */}
          {!selectedPoId && (
            <Pagination
              pageContext={pageContext}
              page={page}
              perPage={perPage}
              onPageChange={setPage}
              onPerPageChange={setPerPage}
              total={total}
              isCounting={isCounting}
              onRequestCount={requestCount}
            />
          )}
        </div>

        {/* Right Panel - Detail View */}
        {selectedPoId && (
          <div className="detail-pane" style={{ flex: 1, overflowY: 'auto' }}>
            <PurchaseOrderDetail poId={selectedPoId} onClose={() => setSearchParams({})} />
          </div>
        )}
      </div>

      <CustomizeColumnsModal
        isOpen={isColumnsOpen}
        catalog={catalog}
        visible={visible}
        onClose={() => setIsColumnsOpen(false)}
        onSave={(keys) => {
          save.mutate(keys);
          setIsColumnsOpen(false);
        }}
        isSaving={save.isPending}
      />

      <ConfirmDialog
        isOpen={!!poToDelete}
        title="Delete Purchase Order"
        message="Are you sure you want to delete this purchase order? This action cannot be undone."
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        onConfirm={() => {
          if (poToDelete) {
            deleteMutation.mutate(poToDelete);
          }
        }}
        onCancel={() => setPoToDelete(null)}
      />

      <ConfirmDialog
        isOpen={isBulkDeleteDialogOpen}
        title="Delete Selected Purchase Orders"
        message={`Are you sure you want to delete ${selectedIds.length} purchase order(s)? This action cannot be undone.`}
        confirmText={isProcessing ? 'Deleting...' : 'Delete'}
        onConfirm={async () => {
          setIsProcessing(true);
          try {
            await Promise.allSettled(selectedIds.map((id) => deletePurchaseOrder(orgId!, id)));
            queryClient.invalidateQueries({ queryKey: ['purchaseOrders', orgId] });
            setSelectedIds([]);
          } finally {
            setIsProcessing(false);
            setIsBulkDeleteDialogOpen(false);
          }
        }}
        onCancel={() => setIsBulkDeleteDialogOpen(false)}
      />

      {/* Refresh Toast Notification */}
      {showRefreshToast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 999,
            background: '#0f172a',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: 8,
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <RotateCw size={15} color="#38bdf8" />
          Purchase orders list refreshed
        </div>
      )}
    </div>
  );
}
