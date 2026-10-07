import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchSalesOrders,
  fetchSalesOrderCount,
  deleteSalesOrder,
} from './sales-orders.api';
import { fetchPaymentTerms, type PaymentTerm } from '../customers/payment-terms.api';
import { Plus, SlidersHorizontal, FileText, MoreVertical, Download } from 'lucide-react';
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { SalesOrderDetail } from './SalesOrderDetail';
import { Pagination } from '../../../components/ui/Pagination';
import { useListSearch } from '../../../hooks/useListSearch';
import { useListCount } from '../../../hooks/useListCount';
import { useListColumns } from '../../../hooks/useListColumns';
import { CustomizeColumnsModal } from '../../../components/ui/CustomizeColumnsModal';
import { ListFilterDropdown } from '../../../components/ui/ListFilterDropdown';
import { BulkActionBar } from '../../../components/ui/BulkActionBar';
import { CUSTOM_FIELD_PREFIX } from '../../list-views/listViews.api';
import { notify } from '../../../lib/notify';
import { useActiveCustomFields } from '../../custom-fields/customFields.api';
import { exportSalesOrdersToExcel, fetchAllSalesOrdersForExport } from './utils/exportSalesOrders';
import type { SalesOrder } from './sales-orders.schemas';

function renderPoCell(po: SalesOrder, key: string, paymentTerms: PaymentTerm[] = []): string {
  if (key === 'paymentTerms') {
    const term = paymentTerms.find((t) => t.id === po.paymentTerms);
    return term ? term.termName : po.paymentTerms || '-';
  }
  if (key.startsWith(CUSTOM_FIELD_PREFIX)) {
    const value = po.customFields?.[key.slice(CUSTOM_FIELD_PREFIX.length)];
    if (value === null || value === undefined || value === '') return '-';
    return Array.isArray(value) ? value.join(', ') : String(value);
  }
  if (key === 'customer') {
    return po.customer?.contactName || '-';
  }
  if (key === 'totalAmount' || key === 'total') {
    return `₹${Number((po as Record<string, unknown>).total || po.totalAmount || 0).toFixed(2)}`;
  }
  const value = (po as unknown as Record<string, unknown>)[key];
  if (value === null || value === undefined || value === '') return '-';
  if (key === 'date' || key === 'deliveryDate' || key === 'createdAt' || key === 'updatedAt') {
    return new Date(String(value)).toLocaleDateString();
  }
  return String(value);
}

export function SalesOrdersList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedPoId = searchParams.get('id');

  const { search, filter, setFilter, perPage, setPerPage, page, setPage } = useListSearch();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['salesOrders', orgId, search, filter, page, perPage],
    queryFn: () =>
      fetchSalesOrders(orgId!, { search: search || undefined, filter, page, perPage }),
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
  });

  const { data: paymentTerms = [] } = useQuery({
    queryKey: ['paymentTerms', orgId],
    queryFn: () => fetchPaymentTerms(orgId!),
    enabled: Boolean(orgId),
  });

  const salesOrders = data?.results ?? [];
  const pageContext = data?.pageContext;

  const { data: customFieldsDef } = useActiveCustomFields(orgId, 'sales_order');

  const {
    total,
    isCounting,
    request: requestCount,
  } = useListCount(['salesOrders-count', orgId, search, filter], () =>
    fetchSalesOrderCount(orgId!, { search: search || undefined, filter }),
  );

  const { catalog, visible, filters, columns, save } = useListColumns(orgId, 'sales_order');
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleExportAll = async () => {
    if (!orgId) return;
    try {
      setIsExporting(true);
      notify.info('Preparing sales orders for export...');
      const allSalesOrders = await fetchAllSalesOrdersForExport(orgId, {
        search: search || undefined,
        filter,
      });

      if (allSalesOrders.length === 0) {
        notify.error('No sales orders found to export.');
        return;
      }

      exportSalesOrdersToExcel({
        salesOrders: allSalesOrders,
        filename: `Sales_Orders_${new Date().toISOString().split('T')[0]}`,
        customFieldsDef,
        visibleColumnKeys: visible,
        exportAllFields: true,
        format: 'xlsx',
      });
      notify.success(`Successfully exported ${allSalesOrders.length} sales orders as XLSX file.`);
    } catch (err) {
      console.error('Failed to export sales orders:', err);
      notify.error('Failed to export sales orders. Please check network connection and try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportSelected = () => {
    const selectedSalesOrders = salesOrders.filter((po) => selectedIds.includes(po.id));
    if (selectedSalesOrders.length === 0) {
      notify.error('No selected sales orders to export.');
      return;
    }
    exportSalesOrdersToExcel({
      salesOrders: selectedSalesOrders,
      filename: `Sales_Orders_Selected_${new Date().toISOString().split('T')[0]}`,
      customFieldsDef,
      visibleColumnKeys: visible,
      exportAllFields: true,
      format: 'xlsx',
    });
    notify.success(
      `Successfully exported ${selectedSalesOrders.length} selected sales orders as XLSX file.`,
    );
  };

  const queryClient = useQueryClient();
  const [poToDelete, setPoToDelete] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSalesOrder(orgId!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salesOrders', orgId] });
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
    if (selectedIds.length === salesOrders.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(salesOrders.map((i) => i.id));
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
              onExport={handleExportSelected}
              onDelete={handleDeleteSelected}
              isProcessing={isProcessing || isExporting}
            />
          ) : (
            <header
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: selectedPoId ? '12px 16px' : '16px 24px',
                background: '#fff',
                borderBottom: '1px solid #eef0f3',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                <ListFilterDropdown
                  filters={filters}
                  value={filter}
                  onChange={setFilter}
                  fallbackLabel="All Sales Orders"
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
                      width: 30,
                      height: 30,
                      borderRadius: 4,
                      border: '1px solid #e2e8f0',
                      background: '#fff',
                      cursor: 'pointer',
                      color: '#64748b',
                    }}
                  >
                    <SlidersHorizontal size={15} />
                  </button>
                )}

                <button
                  onClick={() =>
                    navigate(`/organizations/${orgId}/sales/sales-orders/new`, {
                      state: { returnUrl: location.pathname + location.search },
                    })
                  }
                  style={{
                    background: '#186337',
                    color: 'white',
                    border: 'none',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    fontWeight: 500,
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Plus size={16} /> New
                </button>

                {!selectedPoId && (
                  <div style={{ position: 'relative' }} ref={moreMenuRef}>
                    <button
                      type="button"
                      onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
                      title="More Actions"
                      aria-label="More Actions"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 30,
                        height: 30,
                        borderRadius: 4,
                        border: '1px solid #e2e8f0',
                        background: isMoreMenuOpen ? '#f1f5f9' : '#fff',
                        cursor: 'pointer',
                        color: '#64748b',
                      }}
                    >
                      <MoreVertical size={16} />
                    </button>
                    {isMoreMenuOpen && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '100%',
                          right: 0,
                          marginTop: 4,
                          background: '#fff',
                          border: '1px solid #e2e8f0',
                          borderRadius: 6,
                          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                          minWidth: 220,
                          zIndex: 50,
                          padding: '4px 0',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setIsMoreMenuOpen(false);
                            handleExportAll();
                          }}
                          disabled={isExporting}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '8px 14px',
                            background: 'none',
                            border: 'none',
                            fontSize: 13,
                            color: '#1e293b',
                            cursor: isExporting ? 'not-allowed' : 'pointer',
                            textAlign: 'left',
                            opacity: isExporting ? 0.6 : 1,
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                        >
                          <Download size={15} color="#166534" />
                          Export Sales Orders (XLSX)
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </header>
          )}

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                Loading Sales Orders...
              </div>
            ) : isError ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#ef4444' }}>
                Error loading Sales Orders. Please try again.
              </div>
            ) : salesOrders.length === 0 ? (
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
                  No Sales Orders Found
                </h2>
                <p
                  style={{ color: '#64748b', maxWidth: 400, margin: '0 0 24px 0', lineHeight: 1.5 }}
                >
                  {search
                    ? `No Sales Orders match "${search}".`
                    : "You haven't created any Sales Orders yet."}
                </p>
                <button
                  onClick={() =>
                    navigate(`/organizations/${orgId}/sales/sales-orders/new`, {
                      state: { returnUrl: location.pathname + location.search },
                    })
                  }
                  style={{
                    background: '#28a745',
                    color: 'white',
                    border: 'none',
                    padding: '10px 24px',
                    borderRadius: '4px',
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  Create Sales Order
                </button>
              </div>
            ) : (
              <div>
                {selectedPoId ? (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div
                      style={{
                        padding: '8px 16px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#64748b',
                        background: '#f9f9fb',
                        borderBottom: '1px solid #eef0f3',
                      }}
                    >
                      Sales Orders
                    </div>
                    {salesOrders.map((po) => (
                      <div
                        key={po.id}
                        onClick={() => setSearchParams(prev => { prev.set('id', po.id); return prev; })}
                        style={{
                          padding: '12px 16px',
                          borderBottom: '1px solid #eef0f3',
                          cursor: 'pointer',
                          background: selectedPoId === po.id ? '#f1f5f9' : 'transparent',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={(e) => {
                          if (selectedPoId !== po.id) e.currentTarget.style.background = '#f8fafc';
                        }}
                        onMouseLeave={(e) => {
                          if (selectedPoId !== po.id)
                            e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        {/* Status rides along here too: while the detail is open
                            this pane is the only view of the other SOs, and the
                            table column it comes from is off screen. */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            marginBottom: '4px',
                          }}
                        >
                          <span style={{ fontSize: '13px', fontWeight: 500, color: '#1e293b' }}>
                            {po.soNumber}
                          </span>
                          <span style={{ fontSize: '12px', color: '#64748b' }}>
                            {renderPoCell(po, 'status', paymentTerms)}
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>
                          {po.customer?.contactName || '-'} • ₹
                          {(po as Record<string, unknown>).total || po.totalAmount || 0}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="responsive-table-wrapper">
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr
                          style={{
                            background: '#f9f9fb',
                            borderTop: '1px solid #eef0f3',
                            borderBottom: '1px solid #eef0f3',
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
                                salesOrders.length > 0 &&
                                selectedIds.length === salesOrders.length
                              }
                              onChange={toggleAll}
                              style={{ cursor: 'pointer' }}
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
                        {salesOrders.map((po) => (
                          <tr
                            key={po.id}
                            onClick={() => setSearchParams(prev => { prev.set('id', po.id); return prev; })}
                            style={{
                              borderBottom: '1px solid #eef0f3',
                              transition: 'background 0.1s',
                              cursor: 'pointer',
                              background: selectedIds.includes(po.id) ? '#f8fafc' : 'transparent',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                            onMouseLeave={(e) => {
                              if (!selectedIds.includes(po.id))
                                e.currentTarget.style.background = 'transparent';
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
                                checked={selectedIds.includes(po.id)}
                                onChange={() => toggleSelection(po.id)}
                                style={{ cursor: 'pointer' }}
                              />
                            </td>
                            {columns.map((col) => (
                              <td
                                key={col.key}
                                style={{
                                  padding: '12px 16px',
                                  color: col.key === 'soNumber' ? '#0062ff' : '#333',
                                  fontSize: 13,
                                  fontWeight: col.key === 'soNumber' ? 500 : 400,
                                }}
                              >
                                {renderPoCell(po, col.key, paymentTerms)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Pagination — hidden while a SO is selected (narrow master pane) */}
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
        </div>

        {/* Right Panel - Detail */}
        {selectedPoId && (
          <div className="detail-pane" style={{ flex: 1, overflowY: 'auto' }}>
            <SalesOrderDetail poId={selectedPoId} onClose={() => setSearchParams(prev => { prev.delete('id'); return prev; })} />
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
        title="Delete Sales Order"
        message="Are you sure you want to delete this Sales Order? This action cannot be undone."
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
        title="Delete Selected Sales Orders"
        message={`Are you sure you want to delete ${selectedIds.length} Sales Order(s)? This action cannot be undone.`}
        confirmText={isProcessing ? 'Deleting...' : 'Delete'}
        onConfirm={async () => {
          setIsProcessing(true);
          try {
            await Promise.allSettled(selectedIds.map((id) => deleteSalesOrder(orgId!, id)));
            queryClient.invalidateQueries({ queryKey: ['salesOrders', orgId] });
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
