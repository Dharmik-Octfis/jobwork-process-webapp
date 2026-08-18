import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchBills, fetchBillCount, deleteBill } from './bills.api';
import { fetchPaymentTerms, type PaymentTerm } from './payment-terms.api';
import { Plus, SlidersHorizontal, FileText } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { BillDetail } from './BillDetail';
import { Pagination } from '../../../components/ui/Pagination';
import { useListSearch } from '../../../hooks/useListSearch';
import { useListCount } from '../../../hooks/useListCount';
import { useListColumns } from '../../../hooks/useListColumns';
import { CustomizeColumnsModal } from '../../../components/ui/CustomizeColumnsModal';
import { ListFilterDropdown } from '../../../components/ui/ListFilterDropdown';
import { CUSTOM_FIELD_PREFIX } from '../../list-views/listViews.api';
import type { Bill } from './bills.schemas';

function renderBillCell(po: Bill, key: string, _paymentTerms: PaymentTerm[] = []): string {
  if (key === 'payment_terms') {
    return '-';
  }
  if (key.startsWith(CUSTOM_FIELD_PREFIX)) {
    const value = po.custom_fields?.[key.slice(CUSTOM_FIELD_PREFIX.length)];
    if (value === null || value === undefined || value === '') return '-';
    return Array.isArray(value) ? value.join(', ') : String(value);
  }
  if (key === 'vendor') {
    return po.vendor?.contactName || '-';
  }
  if (key === 'total_amount') {
    return `₹${Number(po.total || po.total_amount || 0).toFixed(2)}`;
  }
  const value = (po as Record<string, unknown>)[key];
  if (value === null || value === undefined || value === '') return '-';
  if (key === 'date' || key === 'due_date' || key === 'created_at' || key === 'updated_at') {
    return new Date(String(value)).toLocaleDateString();
  }
  return String(value);
}

export function BillsList() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedPoId = searchParams.get('id');

  const { search, filter, setFilter, perPage, setPerPage, page, setPage } = useListSearch();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['bills', orgId, search, filter, page, perPage],
    queryFn: () => fetchBills(orgId!, { search: search || undefined, filter, page, perPage }),
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
  });

  const { data: paymentTerms = [] } = useQuery({
    queryKey: ['paymentTerms', orgId],
    queryFn: () => fetchPaymentTerms(orgId!),
    enabled: Boolean(orgId),
  });

  const bills = data?.results ?? [];
  const pageContext = data?.pageContext;

  const {
    total,
    isCounting,
    request: requestCount,
  } = useListCount(['bills-count', orgId, search, filter], () =>
    fetchBillCount(orgId!, { search: search || undefined, filter }),
  );

  const { catalog, visible, filters, columns, save } = useListColumns(orgId, 'bill');
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);

  const queryClient = useQueryClient();
  const [poToDelete, setPoToDelete] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBill(orgId!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills', orgId] });
      setPoToDelete(null);
    },
  });

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
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#f8fafc' }}>
        <div
          style={{
            flex: selectedPoId ? '0 0 320px' : 1,
            borderRight: selectedPoId ? '1px solid #eef0f3' : 'none',
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
          }}
        >
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
                fallbackLabel="All Bills"
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {!selectedPoId && (
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
                onClick={() => navigate(`/organizations/${orgId}/purchases/bills/new`)}
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

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                Loading bills...
              </div>
            ) : isError ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#ef4444' }}>
                Error loading bills. Please try again.
              </div>
            ) : bills.length === 0 ? (
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
                <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1e293b', margin: '0 0 8px 0' }}>
                  No Bills Found
                </h2>
                <p style={{ color: '#64748b', maxWidth: 400, margin: '0 0 24px 0', lineHeight: 1.5 }}>
                  {search ? `No bills match "${search}".` : 'You haven\'t created any bills yet.'}
                </p>
                <button
                  onClick={() => navigate(`/organizations/${orgId}/purchases/bills/new`)}
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
                  Create Bill
                </button>
              </div>
            ) : (
              <div>
                {selectedPoId ? (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 600, color: '#64748b', background: '#f9f9fb', borderBottom: '1px solid #eef0f3' }}>
                      Bills
                    </div>
                    {bills.map((po) => (
                      <div
                        key={po.id}
                        onClick={() => setSearchParams({ id: po.id })}
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
                          if (selectedPoId !== po.id) e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <div style={{ fontSize: '13px', fontWeight: 500, color: '#1e293b', marginBottom: '4px' }}>
                          {po.bill_number}
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>
                          {po.vendor?.contactName || '-'} • ₹{po.total || po.total_amount || 0}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr
                        style={{
                          background: '#f9f9fb',
                          borderTop: '1px solid #eef0f3',
                          borderBottom: '1px solid #eef0f3',
                        }}
                      >
                        {columns.map((col) => (
                          <th key={col.key} style={headerStyle}>
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bills.map((po) => (
                        <tr
                          key={po.id}
                          onClick={() => setSearchParams({ id: po.id })}
                          style={{ borderBottom: '1px solid #eef0f3', transition: 'background 0.1s', cursor: 'pointer' }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          {columns.map((col) => (
                            <td
                              key={col.key}
                              style={{
                                padding: '12px 16px',
                                color: col.key === 'bill_number' ? '#0062ff' : '#333',
                                fontSize: 13,
                                fontWeight: col.key === 'bill_number' ? 500 : 400,
                              }}
                            >
                              {renderBillCell(po, col.key, paymentTerms)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>

          {/* Pagination — hidden while a Bill is selected (narrow master pane) */}
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
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <BillDetail poId={selectedPoId} onClose={() => setSearchParams({})} />
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
        title="Delete Bill"
        message="Are you sure you want to delete this bill? This action cannot be undone."
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        onConfirm={() => {
          if (poToDelete) {
            deleteMutation.mutate(poToDelete);
          }
        }}
        onCancel={() => setPoToDelete(null)}
      />
    </div>
  );
}
