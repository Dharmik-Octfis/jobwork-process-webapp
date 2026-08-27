import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ClipboardList, Plus, SlidersHorizontal } from 'lucide-react';
import { CustomizeColumnsModal } from '../../../components/ui/CustomizeColumnsModal';
import { ListFilterDropdown } from '../../../components/ui/ListFilterDropdown';
import { Pagination } from '../../../components/ui/Pagination';
import { useListColumns } from '../../../hooks/useListColumns';
import { useListCount } from '../../../hooks/useListCount';
import { useListSearch } from '../../../hooks/useListSearch';
import { formatDate } from '../../../lib/formatDate';
import { useActiveCustomFields } from '../../custom-fields/customFields.api';
import { formatCustomFieldValue } from '../../custom-fields/formatCustomFieldValue';
import type { CustomFieldDefinition } from '../../custom-fields/customFields.schemas';
import { CUSTOM_FIELD_PREFIX } from '../../list-views/listViews.api';
import { JOB_ORDER_STATUS_META, formatQty, statusMeta } from '../jobwork.schemas';
import { fetchJobOrderCount, fetchJobOrders } from './jobOrders.api';
import { JobOrderOverview } from './JobOrderOverview';
import type { JobOrder } from './jobOrders.schemas';

const headerStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontWeight: 600,
  fontSize: 11,
  color: '#64748b',
  textTransform: 'uppercase',
};

/** A status pill. Rendered as a node rather than text because it is the column
 * people scan this list for. */
function StatusPill({ status }: { status: string }) {
  const meta = statusMeta(JOB_ORDER_STATUS_META, status);
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 500,
        color: meta.color,
        background: meta.bg,
      }}
    >
      {meta.label}
    </span>
  );
}

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
      return <StatusPill status={order.status} />;
    case 'inputItem':
      return order.inputItem?.name ?? '-';
    case 'inputQty':
      return `${formatQty(order.inputQty)}${
        order.inputUom ? ` ${order.inputUom.symbol ?? order.inputUom.unitName}` : ''
      }`;
    case 'stepCount':
      return String(order.steps.length);
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
  const { orgId } = useParams<{ orgId: string }>();

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

  // The `cf:` columns carry no type in the catalog, so the definitions are what
  // turn a stored option id or `YYYY-MM-DD` into something readable.
  const { data: customFieldDefs = [] } = useActiveCustomFields(orgId, 'job_order');

  const newPath = `/organizations/${orgId}/jobwork/job-orders/new`;

  /**
   * The selection lives in the query string, not in state, so the split view is
   * linkable and survives a reload — the same contract every other list page in
   * the app uses (`ItemsList`, `ProcessesList`). The standalone
   * `/job-orders/:id` route still exists and is what the Create page redirects
   * to; this is the in-list view of the same component.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');
  const openOrder = (id: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('id', id);
      return next;
    });
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
            flex: selectedId ? '0 0 320px' : 1,
            borderRight: selectedId ? '1px solid #eef0f3' : 'none',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: '#fff',
          }}
        >
          <header
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 24px',
              borderBottom: '1px solid #eef0f3',
            }}
          >
            <ListFilterDropdown
              filters={filters}
              value={filter}
              onChange={setFilter}
              fallbackLabel="Open Job Orders"
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {/* No columns to customise while the master pane is 320px wide. */}
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
                type="button"
                onClick={() => navigate(newPath)}
                style={{
                  background: '#186337',
                  color: 'white',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: 4,
                  fontWeight: 500,
                  fontSize: 13,
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
              <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
                Loading job orders…
              </div>
            ) : orders.length === 0 && search ? (
              <div style={{ padding: '48px 32px', textAlign: 'center', color: '#64748b' }}>
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
                  <ClipboardList size={40} color="#94a3b8" />
                </div>
                <h2
                  style={{ fontSize: 20, fontWeight: 600, color: '#1e293b', margin: '0 0 8px 0' }}
                >
                  No Job Orders Yet
                </h2>
                <p
                  style={{ color: '#64748b', maxWidth: 460, margin: '0 0 24px 0', lineHeight: 1.5 }}
                >
                  A job order is one run of work: this much of this item, through these steps.
                  Create one, declare the material that came in with it, and you can start issuing
                  to processors.
                </p>
                <button
                  type="button"
                  onClick={() => navigate(newPath)}
                  style={{
                    background: '#28a745',
                    color: 'white',
                    border: 'none',
                    padding: '10px 24px',
                    borderRadius: 4,
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  Create Job Order
                </button>
              </div>
            ) : selectedId ? (
              /* Narrow master pane beside the detail. Each row is a real button, so
               Tab walks the list and Enter opens a row (CLAUDE.md). */
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {orders.map((order) => (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => openOrder(order.id)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '12px 16px',
                      borderBottom: '1px solid #eef0f3',
                      borderLeft: 'none',
                      borderRight: 'none',
                      borderTop: 'none',
                      cursor: 'pointer',
                      background: selectedId === order.id ? '#f1f5f9' : 'transparent',
                      font: 'inherit',
                    }}
                  >
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 500, color: '#1e293b' }}>
                        {order.jobOrderNumber}
                      </span>
                      <StatusPill status={order.status} />
                    </span>
                    <span style={{ display: 'block', fontSize: 12, color: '#64748b' }}>
                      {order.inputItem?.name ?? '-'} · {formatQty(order.inputQty)}
                      {order.inputUom ? ` ${order.inputUom.symbol ?? order.inputUom.unitName}` : ''}
                    </span>
                  </button>
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
                      <th key={col.key} style={headerStyle} scope="col">
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    /**
                     * The whole row opens the order. The LOCKED column stays a real
                     * `<button>` underneath it: a row `onClick` is invisible to Tab,
                     * so it is the mouse convenience and the button is the control
                     * (CLAUDE.md).
                     */
                    <tr
                      key={order.id}
                      onClick={() => openOrder(order.id)}
                      style={{ borderBottom: '1px solid #eef0f3', cursor: 'pointer' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          style={{ padding: '12px 16px', fontSize: 13, color: '#333' }}
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
                                fontWeight: 500,
                                color: '#0062ff',
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
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Hidden while an order is selected — the master pane is 320px wide. */}
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
          <div style={{ flex: 1, overflowY: 'auto' }}>
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
    </div>
  );
}
