import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchInvoices,
  fetchInvoiceCount,
  deleteInvoice,
} from './invoices.api';
import { fetchPaymentTerms, type PaymentTerm } from '../customers/payment-terms.api';
import { Plus, SlidersHorizontal, FileText } from 'lucide-react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { InvoiceDetail } from './InvoiceDetail';
import { Pagination } from '../../../components/ui/Pagination';
import { useListSearch } from '../../../hooks/useListSearch';
import { useListCount } from '../../../hooks/useListCount';
import { useListColumns } from '../../../hooks/useListColumns';
import { CustomizeColumnsModal } from '../../../components/ui/CustomizeColumnsModal';
import { ListFilterDropdown } from '../../../components/ui/ListFilterDropdown';
import { BulkActionBar } from '../../../components/ui/BulkActionBar';
import { CUSTOM_FIELD_PREFIX } from '../../list-views/listViews.api';
import type { Invoice } from './invoices.schemas';

function renderInvoiceCell(invoice: Invoice, key: string, paymentTerms: PaymentTerm[] = []): string {
  if (key === 'paymentTerms') {
    const term = paymentTerms.find((t) => t.id === invoice.paymentTerms);
    return term ? term.termName : invoice.paymentTerms || '-';
  }
  if (key.startsWith(CUSTOM_FIELD_PREFIX)) {
    const value = invoice.customFields?.[key.slice(CUSTOM_FIELD_PREFIX.length)];
    if (value === null || value === undefined || value === '') return '-';
    return Array.isArray(value) ? value.join(', ') : String(value);
  }
  if (key === 'customer') {
    return invoice.customer?.contactName || '-';
  }
  if (key === 'totalAmount' || key === 'total') {
    return `₹${Number((invoice as Record<string, unknown>).total || invoice.totalAmount || 0).toFixed(2)}`;
  }
  const value = (invoice as unknown as Record<string, unknown>)[key];
  if (value === null || value === undefined || value === '') return '-';
  if (key === 'date' || key === 'dueDate' || key === 'createdAt' || key === 'updatedAt') {
    return new Date(String(value)).toLocaleDateString();
  }
  return String(value);
}

export default function InvoicesList() {
  const navigate = useNavigate();
  const location = useLocation();

  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedInvoiceId = searchParams.get('id');

  const { search, filter, setFilter, perPage, setPerPage, page, setPage } = useListSearch();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['invoices', orgId, search, filter, page, perPage],
    queryFn: () =>
      fetchInvoices(orgId!, { search: search || undefined, filter, page, perPage }),
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
  });

  const { data: paymentTerms = [] } = useQuery({
    queryKey: ['paymentTerms', orgId],
    queryFn: () => fetchPaymentTerms(orgId!),
    enabled: Boolean(orgId),
  });

  const invoices = data?.results ?? [];
  const pageContext = data?.pageContext;

  const {
    total,
    isCounting,
    request: requestCount,
  } = useListCount(['invoices-count', orgId, search, filter], () =>
    fetchInvoiceCount(orgId!, { search: search || undefined, filter }),
  );

  const { catalog, visible, filters, columns, save } = useListColumns(orgId, 'invoice');
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);

  const queryClient = useQueryClient();
  const [invoiceToDelete, setInvoiceToDelete] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteInvoice(orgId!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', orgId] });
      setInvoiceToDelete(null);
    },
  });

  const handleDeleteSelected = async () => {
    setIsBulkDeleteDialogOpen(true);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const toggleAll = () => {
    if (selectedIds.length === invoices.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(invoices.map((i) => i.id));
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
        className={`master-detail-container ${selectedInvoiceId ? 'has-selection' : ''}`}
        style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#f8fafc' }}
      >
        <div
          className="master-pane"
          style={{
            flex: selectedInvoiceId ? '0 0 320px' : 1,
            borderRight: selectedInvoiceId ? '1px solid #eef0f3' : 'none',
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
          }}
        >
          {!selectedInvoiceId && selectedIds.length > 0 ? (
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
                padding: selectedInvoiceId ? '12px 16px' : '16px 24px',
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
                  fallbackLabel="All Invoices"
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {!selectedInvoiceId && (
                  <button
                    onClick={() => setIsColumnsOpen(true)}
                    title="Customize Columns"
                    style={{
                      background: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      borderRadius: '4px',
                      padding: '6px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: 'pointer',
                      color: '#475569',
                      fontSize: '13px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <SlidersHorizontal size={15} />
                  </button>
                )}

                <button
                  onClick={() =>
                    navigate(`/organizations/${orgId}/sales/invoices/new`, {
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
              </div>
            </header>
          )}

          <div style={{ flex: 1, overflow: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                Loading...
              </div>
            ) : isError ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#ef4444' }}>
                Failed to load invoices.
              </div>
            ) : invoices.length === 0 ? (
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
                    marginBottom: 16,
                  }}
                >
                  <FileText size={32} color="#94a3b8" />
                </div>
                <h3 style={{ margin: '0 0 8px', color: '#0f172a', fontSize: 16 }}>No invoices found</h3>
                <p style={{ margin: '0 0 24px', color: '#64748b', fontSize: 14, maxWidth: 320 }}>
                  Get started by creating your first invoice, or try adjusting your search and filters.
                </p>
                <button
                  onClick={() => navigate(`/organizations/${orgId}/sales/invoices/new`)}
                  style={{
                    background: '#186337',
                    color: 'white',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    fontWeight: 500,
                    fontSize: '14px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Plus size={18} /> New Invoice
                </button>
              </div>
            ) : (
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  textAlign: 'left',
                  tableLayout: selectedInvoiceId ? 'fixed' : 'auto',
                }}
              >
                <thead style={{ background: '#f8fafc', borderBottom: '1px solid #eef0f3' }}>
                  <tr>
                    {!selectedInvoiceId && (
                      <th style={{ ...headerStyle, width: 40, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selectedIds.length === invoices.length && invoices.length > 0}
                          onChange={toggleAll}
                          style={{ cursor: 'pointer' }}
                        />
                      </th>
                    )}
                    {selectedInvoiceId ? (
                      <th style={{ ...headerStyle, paddingLeft: 24 }}>Invoice Details</th>
                    ) : (
                      columns.map((col) => (
                        <th key={col.key} style={headerStyle}>
                          {col.label}
                        </th>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const isSelected = selectedInvoiceId === inv.id;
                    const isChecked = selectedIds.includes(inv.id);
                    return (
                      <tr
                        key={inv.id}
                        onClick={(e) => {
                          const target = e.target as HTMLElement;
                          if (target.closest('input[type="checkbox"]')) return;
                          if (target.closest('button')) return;
                          setSearchParams(new URLSearchParams({ id: inv.id }));
                        }}
                        style={{
                          borderBottom: '1px solid #eef0f3',
                          cursor: 'pointer',
                          background: isSelected ? '#f1f5f9' : isChecked ? '#f8fafc' : '#fff',
                          transition: 'background 0.2s',
                        }}
                      >
                        {!selectedInvoiceId && (
                          <td style={{ padding: '12px 16px', textAlign: 'center', width: 40 }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSelection(inv.id)}
                              style={{ cursor: 'pointer' }}
                            />
                          </td>
                        )}
                        {selectedInvoiceId ? (
                          <td style={{ padding: '12px 24px' }}>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                marginBottom: 4,
                              }}
                            >
                              <span style={{ fontWeight: 500, color: '#0f172a' }}>
                                {inv.invoiceNumber}
                              </span>
                              <span style={{ color: '#0052cc', fontWeight: 500, fontSize: 13 }}>
                                {renderInvoiceCell(inv, 'totalAmount', paymentTerms)}
                              </span>
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: 13,
                                color: '#64748b',
                              }}
                            >
                              <span>{inv.customer?.contactName || '-'}</span>
                              <span>{new Date(inv.date).toLocaleDateString()}</span>
                            </div>
                          </td>
                        ) : (
                          columns.map((col) => (
                            <td
                              key={col.key}
                              style={{
                                padding: '12px 16px',
                                fontSize: 13,
                                color: '#334155',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                maxWidth: 250,
                              }}
                            >
                              {col.key === 'status' ? (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    padding: '2px 8px',
                                    borderRadius: 12,
                                    fontSize: 12,
                                    fontWeight: 500,
                                    background:
                                      inv.status === 'Draft'
                                        ? '#f1f5f9'
                                        : inv.status === 'Sent'
                                          ? '#e0f2fe'
                                          : inv.status === 'Paid'
                                            ? '#dcfce7'
                                            : '#f1f5f9',
                                    color:
                                      inv.status === 'Draft'
                                        ? '#475569'
                                        : inv.status === 'Sent'
                                          ? '#0284c7'
                                          : inv.status === 'Paid'
                                            ? '#166534'
                                            : '#475569',
                                  }}
                                >
                                  {inv.status}
                                </span>
                              ) : (
                                renderInvoiceCell(inv, col.key, paymentTerms)
                              )}
                            </td>
                          ))
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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

        {selectedInvoiceId && (
          <div
            className="detail-pane"
            style={{
              flex: 2,
              background: '#fff',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <InvoiceDetail invoiceId={selectedInvoiceId} onClose={() => setSearchParams({})} />
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={Boolean(invoiceToDelete)}
        title="Delete Invoice"
        message="Are you sure you want to delete this invoice? This action cannot be undone."
        confirmText="Delete"
        isConfirming={deleteMutation.isPending}
        onConfirm={() => {
          if (invoiceToDelete) deleteMutation.mutate(invoiceToDelete);
        }}
        onCancel={() => setInvoiceToDelete(null)}
      />

      <ConfirmDialog
        isOpen={isBulkDeleteDialogOpen}
        title="Delete Invoices"
        message={`Are you sure you want to delete ${selectedIds.length} invoice(s)? This action cannot be undone.`}
        confirmText="Delete All"
        isConfirming={isProcessing}
        onConfirm={async () => {
          setIsProcessing(true);
          try {
            for (const id of selectedIds) {
              await deleteInvoice(orgId!, id);
            }
            queryClient.invalidateQueries({ queryKey: ['invoices', orgId] });
            setSelectedIds([]);
            setIsBulkDeleteDialogOpen(false);
          } finally {
            setIsProcessing(false);
          }
        }}
        onCancel={() => setIsBulkDeleteDialogOpen(false)}
      />

      <CustomizeColumnsModal
        isOpen={isColumnsOpen}
        catalog={catalog}
        visible={visible}
        onSave={(cols) => save.mutate(cols)}
        onClose={() => setIsColumnsOpen(false)}
      />
    </div>
  );
}
