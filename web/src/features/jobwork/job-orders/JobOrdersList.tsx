import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { ClipboardList, Plus, SlidersHorizontal } from 'lucide-react';
import { CustomizeColumnsModal } from '../../../components/ui/CustomizeColumnsModal';
import { ListFilterDropdown } from '../../../components/ui/ListFilterDropdown';
import { Pagination } from '../../../components/ui/Pagination';
import { BulkActionBar } from '../../../components/ui/BulkActionBar';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useListColumns } from '../../../hooks/useListColumns';
import { useListCount } from '../../../hooks/useListCount';
import { useListSearch } from '../../../hooks/useListSearch';
import { formatDate } from '../../../lib/formatDate';
import { useActiveCustomFields } from '../../custom-fields/customFields.api';
import { formatCustomFieldValue } from '../../custom-fields/formatCustomFieldValue';
import type { CustomFieldDefinition } from '../../custom-fields/customFields.schemas';
import { CUSTOM_FIELD_PREFIX } from '../../list-views/listViews.api';
import { formatQty } from '../jobwork.schemas';
import { fetchJobOrderCount, fetchJobOrders, deleteJobOrder } from './jobOrders.api';
import { JobOrderOverview } from './JobOrderOverview';
import type { JobOrder } from './jobOrders.schemas';
import { JobOrderStatusBadge } from './JobOrderStatusBadge';

const headerStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontWeight: 600,
  fontSize: 11,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

function renderCell(
  order: JobOrder,
  key: string,
  customFieldDefs: CustomFieldDefinition[],
): React.ReactNode {
  if (key.startsWith(CUSTOM_FIELD_PREFIX)) {
    const cfKey = key.slice(CUSTOM_FIELD_PREFIX.length);
    return formatCustomFieldValue(
      order.customFields?.[cfKey],
      customFieldDefs.find((d) => d.key === cfKey),
    );
  }

  switch (key) {
    case 'status':
      return <JobOrderStatusBadge status={order.status} />;
    case 'inputItem':
      return order.inputItem?.name ?? '-';
    case 'inputQty':
      return `${formatQty(order.inputQty)}${
        order.inputUom ? ` ${order.inputUom.symbol ?? order.inputUom.unitName}` : ''
      }`;
    case 'stepCount':
      return String(order.steps?.length ?? 0);
    case 'ownership':
      return order.ownership === 'customer' ? 'Customer’s' : 'Ours';
    case 'orderDate':
    case 'targetDate':
    case 'createdAt':
    case 'updatedAt':
      return formatDate(order[key]);
    default: {
      const value = (order as unknown as Record<string, unknown>)[key];
      if (value === null || value === undefined || value === '') return '-';
      return String(value);
    }
  }
}

export function JobOrdersList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();

  const { search, filter, setFilter, perPage, setPerPage, page, setPage } = useListSearch('all');

  const { data, isLoading } = useQuery({
    queryKey: ['job-orders', orgId, search, filter, page, perPage],
    queryFn: () => fetchJobOrders(orgId!, { search: search || undefined, filter, page, perPage }),
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
  });

  const orders = data?.results ?? [];
  const pageContext = data?.pageContext;

  const {
    total,
    isCounting,
    request: requestCount,
  } = useListCount(['job-orders-count', orgId, search, filter], () =>
    fetchJobOrderCount(orgId!, { search: search || undefined, filter }),
  );

  const {
    catalog,
    visible,
    filters,
    columns,
    save: saveColumns,
  } = useListColumns(orgId, 'job_order');
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);

  const { data: customFieldDefs = [] } = useActiveCustomFields(orgId, 'job_order');

  const newPath = `/organizations/${orgId}/jobwork/job-orders/new`;

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');
  const openOrder = (id: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('id', id);
      return next;
    });
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const toggleAll = () => {
    if (selectedIds.length === orders.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(orders.map((i) => i.id));
    }
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteJobOrder(orgId!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-orders', orgId] });
      queryClient.invalidateQueries({ queryKey: ['job-orders-count', orgId] });
    },
  });

  const handleBulkDelete = async () => {
    setIsProcessing(true);
    try {
      for (const id of selectedIds) {
        await deleteMutation.mutateAsync(id);
      }
      setSelectedIds([]);
      setIsBulkDeleteDialogOpen(false);
    } catch {
      // toast error handled by mutation
    } finally {
      setIsProcessing(false);
    }
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
        className={`master-detail-container ${selectedId ? 'has-selection' : ''}`}
        style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#f8fafc' }}
      >
        <div
          className="master-pane"
          style={{
            flex: selectedId ? '0 0 320px' : 1,
            borderRight: selectedId ? '1px solid #e2e8f0' : 'none',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: '#fff',
          }}
        >
          {!selectedId && selectedIds.length > 0 ? (
            <BulkActionBar
              selectedCount={selectedIds.length}
              onClearSelection={() => setSelectedIds([])}
              onDelete={() => setIsBulkDeleteDialogOpen(true)}
              isProcessing={isProcessing}
            />
          ) : (
            <header
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: selectedId ? '12px 16px' : '16px 24px',
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
                  fallbackLabel="Open Job Orders"
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                {!selectedId && (
                  <button
                    type="button"
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
                  type="button"
                  onClick={() =>
                    navigate(newPath, { state: { returnUrl: location.pathname + location.search } })
                  }
                  style={{
                    background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                    color: 'white',
                    border: 'none',
                    padding: '7px 14px',
                    borderRadius: 6,
                    fontWeight: 600,
                    fontSize: 13,
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
                  <Plus size={16} /> New
                </button>
              </div>
            </header>
          )}

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: 48, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                Loading job orders…
              </div>
            ) : orders.length === 0 && search ? (
              <div
                style={{
                  padding: '48px 32px',
                  textAlign: 'center',
                  color: '#64748b',
                  fontSize: 13,
                }}
              >
                No job orders match &ldquo;{search}&rdquo;.
              </div>
            ) : orders.length === 0 ? (
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
                    background: '#f0f7fd',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 16,
                  }}
                >
                  <ClipboardList size={36} color="#0284c7" />
                </div>
                <h2
                  style={{ fontSize: 18, fontWeight: 600, color: '#0f172a', margin: '0 0 8px 0' }}
                >
                  No Job Orders Yet
                </h2>
                <p
                  style={{
                    color: '#64748b',
                    maxWidth: 440,
                    margin: '0 0 24px 0',
                    lineHeight: 1.5,
                    fontSize: 13,
                  }}
                >
                  A job order tracks manufacturing work: specify the input material, plan the
                  sequence of processes, and issue challans to internal work centres or external
                  jobworkers.
                </p>
                <button
                  type="button"
                  onClick={() => navigate(newPath)}
                  style={{
                    background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                    color: 'white',
                    border: 'none',
                    padding: '9px 20px',
                    borderRadius: 6,
                    fontWeight: 600,
                    fontSize: 13,
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
                  Create Job Order
                </button>
              </div>
            ) : selectedId ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {orders.map((order) => {
                  const isSelected = selectedId === order.id;
                  return (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => openOrder(order.id)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '12px 16px',
                        borderBottom: '1px solid #f1f5f9',
                        borderLeft: isSelected ? '3px solid #0284c7' : '3px solid transparent',
                        borderRight: 'none',
                        borderTop: 'none',
                        cursor: 'pointer',
                        background: isSelected ? '#f0f7fd' : '#fff',
                        font: 'inherit',
                        transition: 'background-color 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.background = '#f8fafc';
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.background = '#fff';
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: isSelected ? '#0369a1' : '#0f172a',
                          }}
                        >
                          {order.jobOrderNumber}
                        </span>
                        <JobOrderStatusBadge status={order.status} size="sm" />
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontSize: 12, color: '#64748b' }}>
                          {order.inputItem?.name ?? '-'} · {formatQty(order.inputQty)}
                          {order.inputUom
                            ? ` ${order.inputUom.symbol ?? order.inputUom.unitName}`
                            : ''}
                        </span>
                        {order.orderDate && (
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>
                            {formatDate(order.orderDate)}
                          </span>
                        )}
                      </div>
                    </button>
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
                        borderBottom: '1px solid #e2e8f0',
                      }}
                    >
                      <th style={{ width: 44, padding: '12px 16px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={orders.length > 0 && selectedIds.length === orders.length}
                          onChange={toggleAll}
                          style={{ cursor: 'pointer', accentColor: '#0284c7' }}
                        />
                      </th>
                      {columns.map((col) => (
                        <th key={col.key} style={headerStyle} scope="col">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => {
                      const isRowSelected = selectedIds.includes(order.id);
                      return (
                        <tr
                          key={order.id}
                          onClick={() => openOrder(order.id)}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            cursor: 'pointer',
                            background: isRowSelected ? '#f0f7fd' : '#fff',
                            transition: 'background-color 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            if (!isRowSelected) e.currentTarget.style.background = '#f8fafc';
                          }}
                          onMouseLeave={(e) => {
                            if (!isRowSelected) e.currentTarget.style.background = '#fff';
                          }}
                        >
                          <td
                            style={{ width: 44, padding: '12px 16px', textAlign: 'center' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={isRowSelected}
                              onChange={() => toggleSelection(order.id)}
                              style={{ cursor: 'pointer', accentColor: '#0284c7' }}
                            />
                          </td>
                          {columns.map((col) => (
                            <td
                              key={col.key}
                              style={{ padding: '12px 16px', fontSize: 13, color: '#334155' }}
                            >
                              {col.locked ? (
                                <button
                                  type="button"
                                  onClick={() => openOrder(order.id)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: 0,
                                    font: 'inherit',
                                    fontWeight: 600,
                                    color: '#0284c7',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                  }}
                                >
                                  {renderCell(order, col.key, customFieldDefs)}
                                </button>
                              ) : (
                                renderCell(order, col.key, customFieldDefs)
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

          {!selectedId && (
            <Pagination
              pageContext={pageContext}
              page={page}
              onPageChange={setPage}
              perPage={perPage}
              onPerPageChange={setPerPage}
              total={total}
              isCounting={isCounting}
              onRequestCount={() => void requestCount()}
            />
          )}
        </div>

        {selectedId && (
          <div className="detail-pane" style={{ flex: 1, overflowY: 'auto' }}>
            <JobOrderOverview
              jobOrderId={selectedId}
              onClose={() => {
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.delete('id');
                  return next;
                });
              }}
            />
          </div>
        )}
      </div>

      <CustomizeColumnsModal
        isOpen={isColumnsOpen}
        onClose={() => setIsColumnsOpen(false)}
        catalog={catalog}
        visible={visible}
        isSaving={saveColumns.isPending}
        onSave={(cols) => saveColumns.mutate(cols, { onSuccess: () => setIsColumnsOpen(false) })}
      />

      <ConfirmDialog
        isOpen={isBulkDeleteDialogOpen}
        onCancel={() => setIsBulkDeleteDialogOpen(false)}
        onConfirm={handleBulkDelete}
        title="Delete Selected Job Orders"
        message={`Are you sure you want to delete ${selectedIds.length} selected job order(s)? Orders with issued challans cannot be deleted.`}
        confirmText={isProcessing ? 'Deleting...' : 'Delete'}
        isConfirming={isProcessing}
      />
    </div>
  );
}
