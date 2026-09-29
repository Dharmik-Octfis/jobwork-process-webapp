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
  ChevronRight,
  Download,
  Upload,
  RotateCw,
  Settings,
  Layers,
  ArrowUpDown,
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
import type { PurchaseOrder } from './purchase-orders.schemas';
import { PurchaseOrderStatusBadge } from './PurchaseOrderStatusBadge';
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

function renderPoCell(
  po: PurchaseOrder,
  key: string,
  paymentTerms: PaymentTerm[] = [],
  customFieldsDef?: CustomFieldDefinition[],
): React.ReactNode {
  if (key === 'billed' || key === 'billedStatus') {
    const isBilled = Boolean(po.bills && po.bills.length > 0);
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <span
          title={isBilled ? 'Billed' : 'Unbilled'}
          style={{
            display: 'inline-block',
            width: 7,
            height: 7,
            borderRadius: '50%',
            backgroundColor: isBilled ? '#0284c7' : '#cbd5e1',
          }}
        />
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
            display: 'inline-block',
            width: 7,
            height: 7,
            borderRadius: '50%',
            backgroundColor: isReceived ? '#0284c7' : '#cbd5e1',
          }}
        />
      </div>
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

  if (key === 'totalAmount' || key === 'total' || key === 'amount') {
    const amt = Number((po as Record<string, unknown>).total || po.totalAmount || 0);
    return `₹${amt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

  const [sortBy, setSortBy] = useState<string>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isSortSubmenuOpen, setIsSortSubmenuOpen] = useState(false);

  const purchaseOrders = useMemo(() => {
    return [...(results ?? [])].sort((a, b) => {
      let valA: unknown = '';
      let valB: unknown = '';
      if (sortBy === 'date') {
        valA = new Date(a.date || 0).getTime();
        valB = new Date(b.date || 0).getTime();
      } else if (sortBy === 'poNumber') {
        valA = (a.poNumber || '').toLowerCase();
        valB = (b.poNumber || '').toLowerCase();
      } else if (sortBy === 'vendorName') {
        valA = (a.vendor?.contactName || '').toLowerCase();
        valB = (b.vendor?.contactName || '').toLowerCase();
      } else if (sortBy === 'amount') {
        valA = Number((a as Record<string, unknown>).total || a.totalAmount || 0);
        valB = Number((b as Record<string, unknown>).total || b.totalAmount || 0);
      } else if (sortBy === 'createdAt') {
        valA = new Date((a as unknown as { createdAt?: string }).createdAt || 0).getTime();
        valB = new Date((b as unknown as { createdAt?: string }).createdAt || 0).getTime();
      } else if (sortBy === 'updatedAt') {
        valA = new Date((a as unknown as { updatedAt?: string }).updatedAt || 0).getTime();
        valB = new Date((b as unknown as { updatedAt?: string }).updatedAt || 0).getTime();
      }

      if ((valA as number | string) < (valB as number | string))
        return sortOrder === 'asc' ? -1 : 1;
      if ((valA as number | string) > (valB as number | string))
        return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [results, sortBy, sortOrder]);

  const {
    total,
    isCounting,
    request: requestCount,
  } = useListCount(['purchaseOrders-count', orgId, search, filter], () =>
    fetchPurchaseOrderCount(orgId!, { search: search || undefined, filter }),
  );

  const { catalog, visible, filters, columns, save } = useListColumns(orgId, 'purchase_order');
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    }
    if (isMoreMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isMoreMenuOpen]);

  const queryClient = useQueryClient();
  const [poToDelete, setPoToDelete] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);

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

  const headerStyle: React.CSSProperties = {
    padding: '12px 16px',
    fontWeight: 600,
    fontSize: 11.5,
    color: '#475569',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  };

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
            flex: selectedPoId ? '0 0 320px' : 1,
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
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                <ListFilterDropdown
                  filters={filters}
                  value={filter}
                  onChange={setFilter}
                  fallbackLabel="All Purchase Orders"
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                {!selectedPoId ? (
                  <>
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
                        gap: 5,
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
                      <Plus size={16} /> New
                    </button>

                    {/* More Options (...) button with dropdown menu matching Screenshot 3 */}
                    <div ref={moreMenuRef} style={{ position: 'relative' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setIsMoreMenuOpen((prev) => !prev);
                          setIsSortSubmenuOpen(false);
                        }}
                        title="More options"
                        aria-label="More options"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 32,
                          height: 32,
                          borderRadius: 6,
                          border: '1px solid #cbd5e1',
                          background: isMoreMenuOpen ? '#f1f5f9' : '#fff',
                          cursor: 'pointer',
                          color: '#475569',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#f8fafc';
                          e.currentTarget.style.borderColor = '#94a3b8';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = isMoreMenuOpen ? '#f1f5f9' : '#fff';
                          e.currentTarget.style.borderColor = '#cbd5e1';
                        }}
                      >
                        <MoreHorizontal size={16} />
                      </button>

                      {isMoreMenuOpen && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 'calc(100% + 4px)',
                            right: 0,
                            width: '230px',
                            background: '#ffffff',
                            border: '1px solid #e2e8f0',
                            borderRadius: '8px',
                            boxShadow:
                              '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                            zIndex: 100,
                            padding: '6px 0',
                          }}
                        >
                          {/* Sort By item with hover submenu */}
                          <div
                            style={{ position: 'relative' }}
                            onMouseEnter={() => setIsSortSubmenuOpen(true)}
                            onMouseLeave={() => setIsSortSubmenuOpen(false)}
                          >
                            <div
                              onClick={() => setIsSortSubmenuOpen((prev) => !prev)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '8px 16px',
                                fontSize: '13px',
                                color: isSortSubmenuOpen ? '#0284c7' : '#1e293b',
                                cursor: 'pointer',
                                background: isSortSubmenuOpen ? '#f0f9ff' : 'transparent',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <ArrowUpDown size={15} color="#0284c7" />
                                <span style={{ fontWeight: 500 }}>Sort by</span>
                              </div>
                              <ChevronRight size={14} color="#64748b" />
                            </div>

                            {/* Sort Submenu to the left */}
                            {isSortSubmenuOpen && (
                              <div
                                style={{
                                  position: 'absolute',
                                  top: 0,
                                  right: '100%',
                                  width: '190px',
                                  background: '#ffffff',
                                  border: '1px solid #e2e8f0',
                                  borderRadius: '8px',
                                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                                  zIndex: 101,
                                  padding: '4px',
                                  marginRight: '2px',
                                }}
                              >
                                {[
                                  { label: 'Date', key: 'date' },
                                  { label: 'Purchase Order#', key: 'poNumber' },
                                  { label: 'Vendor Name', key: 'vendorName' },
                                  { label: 'Amount', key: 'amount' },
                                  { label: 'Created Time', key: 'createdAt' },
                                  { label: 'Last Modified Time', key: 'updatedAt' },
                                ].map((item) => {
                                  const isSelected = sortBy === item.key;
                                  return (
                                    <div
                                      key={item.key}
                                      onClick={() => {
                                        if (sortBy === item.key) {
                                          setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
                                        } else {
                                          setSortBy(item.key);
                                          setSortOrder(
                                            item.key === 'createdAt' || item.key === 'updatedAt'
                                              ? 'desc'
                                              : 'asc',
                                          );
                                        }
                                        setIsMoreMenuOpen(false);
                                      }}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '7px 12px',
                                        borderRadius: '5px',
                                        fontSize: '12.5px',
                                        color: isSelected ? '#ffffff' : '#334155',
                                        background: isSelected ? '#0284c7' : 'transparent',
                                        cursor: 'pointer',
                                        fontWeight: isSelected ? 600 : 400,
                                        marginBottom: '2px',
                                      }}
                                      onMouseEnter={(e) => {
                                        if (!isSelected)
                                          e.currentTarget.style.background = '#f8fafc';
                                      }}
                                      onMouseLeave={(e) => {
                                        if (!isSelected)
                                          e.currentTarget.style.background = 'transparent';
                                      }}
                                    >
                                      <span>{item.label}</span>
                                      {isSelected && (
                                        <span>{sortOrder === 'desc' ? '↓' : '↑'}</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          <div style={{ height: '1px', background: '#f1f5f9', margin: '4px 0' }} />

                          {/* Import Purchase Orders */}
                          <div
                            onClick={() => {
                              setIsMoreMenuOpen(false);
                              alert('Import Purchase Orders feature will be available soon.');
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '8px 16px',
                              fontSize: '13px',
                              color: '#1e293b',
                              cursor: 'pointer',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <Download size={15} color="#0284c7" />
                            <span>Import Purchase Orders</span>
                          </div>

                          {/* Export */}
                          <div
                            onClick={() => {
                              setIsMoreMenuOpen(false);
                              const csvRows = [
                                ['Purchase Order#', 'Date', 'Vendor Name', 'Status', 'Amount'].join(
                                  ',',
                                ),
                                ...purchaseOrders.map((po) =>
                                  [
                                    `"${po.poNumber || ''}"`,
                                    `"${po.date || ''}"`,
                                    `"${po.vendor?.contactName || ''}"`,
                                    `"${po.status || ''}"`,
                                    `"${po.totalAmount || 0}"`,
                                  ].join(','),
                                ),
                              ];
                              const blob = new Blob([csvRows.join('\n')], {
                                type: 'text/csv',
                              });
                              const url = window.URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `purchase-orders-${format(new Date(), 'yyyy-MM-dd')}.csv`;
                              a.click();
                              window.URL.revokeObjectURL(url);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '8px 16px',
                              fontSize: '13px',
                              color: '#1e293b',
                              cursor: 'pointer',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <Upload size={15} color="#0284c7" />
                              <span>Export</span>
                            </div>
                            <ChevronRight size={14} color="#64748b" />
                          </div>

                          <div style={{ height: '1px', background: '#f1f5f9', margin: '4px 0' }} />

                          {/* Preferences */}
                          <div
                            onClick={() => {
                              setIsMoreMenuOpen(false);
                              navigate(`/organizations/${orgId}/purchases/purchase-orders/new`);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '8px 16px',
                              fontSize: '13px',
                              color: '#1e293b',
                              cursor: 'pointer',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <Settings size={15} color="#0284c7" />
                            <span>Preferences</span>
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
                              gap: '10px',
                              padding: '8px 16px',
                              fontSize: '13px',
                              color: '#1e293b',
                              cursor: 'pointer',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <Layers size={15} color="#0284c7" />
                            <span>Manage Custom Fields</span>
                          </div>

                          {/* Refresh List */}
                          <div
                            onClick={() => {
                              setIsMoreMenuOpen(false);
                              queryClient.invalidateQueries({
                                queryKey: ['purchaseOrders', orgId],
                              });
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '8px 16px',
                              fontSize: '13px',
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
                  </>
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
              </div>
            </header>
          )}

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                Loading purchase orders...
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
                    width: 80,
                    height: 80,
                    borderRadius: '50%',
                    background: '#f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '16px',
                  }}
                >
                  <FileText size={40} color="#94a3b8" />
                </div>
                <h2
                  style={{ fontSize: 20, fontWeight: 600, color: '#1e293b', margin: '0 0 8px 0' }}
                >
                  No Purchase Orders Found
                </h2>
                <p
                  style={{ color: '#64748b', maxWidth: 400, margin: '0 0 24px 0', lineHeight: 1.5 }}
                >
                  {search
                    ? `No purchase orders match "${search}".`
                    : "You haven't created any purchase orders yet."}
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
                    padding: '10px 24px',
                    borderRadius: '6px',
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: 'pointer',
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
                  Create Purchase Order
                </button>
              </div>
            ) : (
              <div>
                {selectedPoId ? (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div
                      style={{
                        padding: '10px 16px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#64748b',
                        background: '#f8fafc',
                        borderBottom: '1px solid #e2e8f0',
                        letterSpacing: '0.03em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {filters.find((f) => f.key === filter)?.label ?? 'All Purchase Orders'}
                    </div>
                    {purchaseOrders.map((po) => {
                      const isSelected = selectedPoId === po.id;
                      const statusUpper = (po.status || 'DRAFT').toUpperCase();
                      const statusColor =
                        statusUpper === 'ISSUED'
                          ? '#0284c7'
                          : statusUpper === 'APPROVED'
                            ? '#16a34a'
                            : statusUpper === 'CLOSED'
                              ? '#475569'
                              : statusUpper.includes('PENDING')
                                ? '#ea580c'
                                : statusUpper === 'CANCELLED'
                                  ? '#ef4444'
                                  : '#64748b';

                      return (
                        <div
                          key={po.id}
                          onClick={() => setSearchParams({ id: po.id })}
                          style={{
                            padding: '12px 14px',
                            borderBottom: '1px solid #f1f5f9',
                            cursor: 'pointer',
                            background: isSelected ? '#f0f7fd' : 'transparent',
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
                            style={{ marginTop: 2, cursor: 'pointer' }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'baseline',
                                marginBottom: 3,
                              }}
                            >
                              <span
                                style={{
                                  fontWeight: 600,
                                  fontSize: 13,
                                  color: '#1e293b',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {po.vendor?.contactName || po.vendor?.companyName || '-'}
                              </span>
                              <span
                                style={{
                                  fontWeight: 600,
                                  fontSize: 13,
                                  color: '#1e293b',
                                  marginLeft: 8,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                ₹{Number(po.totalAmount || 0).toFixed(2)}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>
                              {po.poNumber} • {formatDate(po.date)}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                letterSpacing: '0.04em',
                                color: statusColor,
                              }}
                            >
                              {po.status}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="responsive-table-wrapper">
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
                          {columns.map((col, idx) => {
                            const isLast = idx === columns.length - 1;
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
                                  width: isCenter ? 85 : undefined,
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: isRight
                                      ? 'flex-end'
                                      : isCenter
                                        ? 'center'
                                        : 'space-between',
                                    gap: 6,
                                  }}
                                >
                                  <span>{col.label}</span>
                                  {isLast && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const searchInput =
                                          document.querySelector<HTMLInputElement>(
                                            '.topbar-search-area input, .global-search-container input, input[placeholder*="Search"]',
                                          );
                                        if (searchInput) {
                                          searchInput.focus();
                                          searchInput.select();
                                        }
                                      }}
                                      title="Search in Purchase Orders"
                                      aria-label="Search"
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        color: '#94a3b8',
                                        padding: '2px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        marginLeft: 4,
                                        transition: 'color 0.15s ease',
                                      }}
                                      onMouseEnter={(e) =>
                                        (e.currentTarget.style.color = '#0284c7')
                                      }
                                      onMouseLeave={(e) =>
                                        (e.currentTarget.style.color = '#94a3b8')
                                      }
                                    >
                                      <Search size={13} />
                                    </button>
                                  )}
                                </div>
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
                                transition: 'background 0.12s ease',
                                cursor: 'pointer',
                                background: isChecked ? '#f0f7fd' : 'transparent',
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
                                      <PurchaseOrderStatusBadge status={po.status} variant="text" />
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

          {/* Pagination — hidden while a PO is selected (narrow master pane) */}
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

        {/* Right Panel - Detail */}
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
    </div>
  );
}
