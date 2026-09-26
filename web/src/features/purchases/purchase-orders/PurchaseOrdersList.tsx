import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchPurchaseOrders,
  fetchPurchaseOrderCount,
  deletePurchaseOrder,
} from './purchase-orders.api';
import { fetchPaymentTerms, type PaymentTerm } from './payment-terms.api';
import { Plus, SlidersHorizontal, FileText } from 'lucide-react';
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
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

function formatDate(val: unknown): string {
  if (!val) return '-';
  try {
    const d = new Date(String(val));
    if (isNaN(d.getTime())) return '-';
    return format(d, 'dd MMM yyyy');
  } catch {
    return String(val);
  }
}

function renderPoCell(po: PurchaseOrder, key: string, paymentTerms: PaymentTerm[] = []): string {
  if (key === 'paymentTerms') {
    const term = paymentTerms.find((t) => t.id === po.paymentTerms);
    return term ? term.termName : po.paymentTerms || '-';
  }
  if (key.startsWith(CUSTOM_FIELD_PREFIX)) {
    const value = po.customFields?.[key.slice(CUSTOM_FIELD_PREFIX.length)];
    if (value === null || value === undefined || value === '') return '-';
    return Array.isArray(value) ? value.join(', ') : String(value);
  }
  if (key === 'referenceNumber') {
    return (
      po.referenceNumber ||
      ((po.customFields as Record<string, unknown>)?.referenceNumber as string) ||
      ((po.customFields as Record<string, unknown>)?.reference as string) ||
      '-'
    );
  }
  if (key === 'billedStatus') {
    const hasBills = Boolean(po.bills && po.bills.length > 0);
    return hasBills ? 'BILLED' : 'YET TO BE BILLED';
  }
  if (key === 'vendor') {
    return po.vendor?.contactName || '-';
  }
  if (key === 'totalAmount' || key === 'total') {
    const amt = Number((po as Record<string, unknown>).total || po.totalAmount || 0);
    return `₹${amt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (key === 'date' || key === 'deliveryDate' || key === 'createdAt' || key === 'updatedAt') {
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

  const purchaseOrders = data?.results ?? [];
  const pageContext = data?.pageContext;

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

  const headerStyle = {
    padding: '12px 16px',
    fontWeight: 600,
    fontSize: 11,
    color: '#64748b',
    textTransform: 'uppercase' as const,
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

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                {!selectedPoId && (
                  <button
                    onClick={() => setIsColumnsOpen(true)}
                    title="Customize Columns"
                    aria-label="Customize Columns"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      border: '1px solid #e2e8f0',
                      background: '#fff',
                      cursor: 'pointer',
                      color: '#64748b',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f0f7fd';
                      e.currentTarget.style.color = '#0284c7';
                      e.currentTarget.style.borderColor = 'rgba(2, 132, 199, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#fff';
                      e.currentTarget.style.color = '#64748b';
                      e.currentTarget.style.borderColor = '#e2e8f0';
                    }}
                  >
                    <SlidersHorizontal size={15} />
                  </button>
                )}

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
                    boxShadow: '0 2px 8px rgba(2, 132, 199, 0.25)',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(2, 132, 199, 0.35)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(2, 132, 199, 0.25)';
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
                      return (
                        <div
                          key={po.id}
                          onClick={() => setSearchParams({ id: po.id })}
                          style={{
                            padding: '12px 16px',
                            borderBottom: '1px solid #f1f5f9',
                            cursor: 'pointer',
                            background: isSelected ? '#f0f7fd' : 'transparent',
                            borderLeft: isSelected ? '3px solid #0284c7' : '3px solid transparent',
                            transition: 'all 0.12s ease',
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) e.currentTarget.style.background = '#f8fafc';
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 8,
                              marginBottom: '6px',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '13px',
                                fontWeight: isSelected ? 600 : 500,
                                color: isSelected ? '#0284c7' : '#1e293b',
                              }}
                            >
                              {po.poNumber}
                            </span>
                            <PurchaseOrderStatusBadge status={po.status} />
                          </div>
                          <div style={{ fontSize: '12px', color: '#64748b' }}>
                            {po.vendor?.contactName || '-'} • ₹
                            {Number(
                              (po as Record<string, unknown>).total || po.totalAmount || 0,
                            ).toFixed(2)}
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
                              width: 48,
                              ...headerStyle,
                              paddingRight: 0,
                              textAlign: 'center',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={
                                purchaseOrders.length > 0 &&
                                selectedIds.length === purchaseOrders.length
                              }
                              onChange={toggleAll}
                              style={{ cursor: 'pointer', accentColor: '#0284c7' }}
                            />
                          </th>
                          {columns.map((col) => (
                            <th key={col.key} style={headerStyle}>
                              {col.label}
                            </th>
                          ))}
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
                                  width: 48,
                                  padding: '12px 16px',
                                  paddingRight: 0,
                                  textAlign: 'center',
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
                              {columns.map((col) => (
                                <td
                                  key={col.key}
                                  style={{
                                    padding: '12px 16px',
                                    color: col.key === 'poNumber' ? '#0284c7' : '#334155',
                                    fontSize: 13,
                                    fontWeight: col.key === 'poNumber' ? 600 : 400,
                                  }}
                                >
                                  {col.key === 'status' ? (
                                    <PurchaseOrderStatusBadge status={po.status} variant="text" />
                                  ) : (
                                    renderPoCell(po, col.key, paymentTerms)
                                  )}
                                </td>
                              ))}
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
