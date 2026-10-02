import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { useListSearch } from '../../../hooks/useListSearch';
import { useListCount } from '../../../hooks/useListCount';
import { Pagination } from '../../../components/ui/Pagination';
import { formatDate } from '../../../lib/formatDate';
import { formatQty, toNumber } from '../../jobwork/jobwork.schemas';
import { AdjustmentDetail } from './AdjustmentDetail';
import { fetchAdjustmentCount, fetchAdjustments } from './adjustments.api';
import {
  ADJUSTMENT_STATUS_META,
  adjustmentReasonLabel,
  type StockAdjustmentRow,
} from './adjustments.schemas';

const headerStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontWeight: 600,
  fontSize: 11,
  color: '#64748b',
  textTransform: 'uppercase',
  borderBottom: '1px solid #eef0f3',
  whiteSpace: 'nowrap',
};
const cellStyle: React.CSSProperties = { padding: '12px 16px', fontSize: 13, color: '#333' };

function StatusPill({ status }: { status: string }) {
  const meta = ADJUSTMENT_STATUS_META[status] ?? { label: status, color: '#475569', bg: '#f1f5f9' };
  return (
    <span
      style={{
        display: 'inline-flex',
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 500,
        background: meta.bg,
        color: meta.color,
      }}
    >
      {meta.label}
    </span>
  );
}

function SignedQty({ row }: { row: StockAdjustmentRow }) {
  const quantity = toNumber(row.quantityAdjusted);
  return (
    <span style={{ color: quantity > 0 ? '#166534' : '#b91c1c', fontWeight: 500 }}>
      {quantity > 0 ? '+' : '−'}
      {formatQty(Math.abs(quantity))}
    </span>
  );
}

/**
 * Inventory → Adjustments. A record of every stock adjustment, cancelled ones
 * included. There is no "New" here: an adjustment is made from the item it
 * adjusts (the Adjust Stock button on the item's page).
 */
export function AdjustmentsList() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');
  const { search, perPage, setPerPage, page, setPage } = useListSearch();

  const { data, isLoading } = useQuery({
    queryKey: ['stockAdjustments', orgId, search, page, perPage],
    queryFn: () => fetchAdjustments(orgId!, { search: search || undefined, page, perPage }),
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
  });
  const rows = data?.results ?? [];

  const {
    total,
    isCounting,
    request: requestCount,
  } = useListCount(['stockAdjustments-count', orgId, search], () =>
    fetchAdjustmentCount(orgId!, { search: search || undefined }),
  );

  const open = (id: string) =>
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('id', id);
      return params;
    });
  const close = () =>
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('id');
      return params;
    });

  const empty = (
    <div style={{ padding: '48px 24px', textAlign: 'center', color: '#64748b' }}>
      <ClipboardList size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
      <div style={{ fontSize: 14, fontWeight: 500, color: '#1e293b' }}>
        {search ? 'No adjustments match your search' : 'No stock adjustments yet'}
      </div>
      {!search && (
        <div style={{ fontSize: 13, marginTop: 4 }}>
          Open an item and use Adjust Stock to record one.
        </div>
      )}
    </div>
  );

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
            borderRight: selectedId ? '1px solid #eef0f3' : 'none',
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
            minWidth: 0,
          }}
        >
          <header
            style={{
              padding: '16px 24px',
              background: '#fff',
              borderBottom: '1px solid #eef0f3',
              fontSize: 16,
              fontWeight: 600,
              color: '#111',
            }}
          >
            Stock Adjustments
          </header>

          <div style={{ flex: 1, overflow: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading…</div>
            ) : rows.length === 0 ? (
              empty
            ) : selectedId ? (
              rows.map((row) => (
                // A real button: a clickable div is skipped by Tab.
                <button
                  key={row.id}
                  type="button"
                  onClick={() => open(row.id)}
                  aria-current={selectedId === row.id}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 16px',
                    border: 'none',
                    borderBottom: '1px solid #eef0f3',
                    cursor: 'pointer',
                    background: selectedId === row.id ? '#f1f5f9' : '#fff',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#1e293b', marginBottom: 4 }}>
                    {row.adjustmentNumber}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: '#334155',
                      marginBottom: 8,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.item.name}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <StatusPill status={row.status} />
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      {formatDate(row.adjustmentDate)}
                    </span>
                  </div>
                </button>
              ))
            ) : (
              <div className="responsive-table-wrapper">
                <table
                  style={{
                    width: '100%',
                    minWidth: 760,
                    borderCollapse: 'collapse',
                    textAlign: 'left',
                  }}
                >
                  <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
                    <tr>
                      <th style={headerStyle}>Date</th>
                      <th style={headerStyle}>Adjustment#</th>
                      <th style={headerStyle}>Item</th>
                      <th style={headerStyle}>Location</th>
                      <th style={{ ...headerStyle, textAlign: 'right' }}>Quantity Adjusted</th>
                      <th style={headerStyle}>Reason</th>
                      <th style={headerStyle}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => open(row.id)}
                        style={{ borderBottom: '1px solid #eef0f3', cursor: 'pointer' }}
                      >
                        <td style={cellStyle}>{formatDate(row.adjustmentDate)}</td>
                        <td style={cellStyle}>
                          {/* The keyboard's way into the row — the row click is the mouse's. */}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              open(row.id);
                            }}
                            style={{
                              padding: 0,
                              border: 'none',
                              background: 'none',
                              color: '#0062ff',
                              fontWeight: 500,
                              fontSize: 13,
                              cursor: 'pointer',
                            }}
                          >
                            {row.adjustmentNumber}
                          </button>
                        </td>
                        <td style={cellStyle}>{row.item.name}</td>
                        <td style={cellStyle}>{row.location.name}</td>
                        <td style={{ ...cellStyle, textAlign: 'right' }}>
                          <SignedQty row={row} />
                        </td>
                        <td style={cellStyle}>{adjustmentReasonLabel(row.reason)}</td>
                        <td style={cellStyle}>
                          <StatusPill status={row.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {!selectedId && (
            <Pagination
              pageContext={data?.pageContext}
              perPage={perPage}
              page={page}
              onPageChange={setPage}
              onPerPageChange={setPerPage}
              total={total}
              isCounting={isCounting}
              onRequestCount={requestCount}
            />
          )}
        </div>

        {selectedId && orgId && (
          <div
            className="detail-pane"
            style={{
              flex: 1,
              borderLeft: '1px solid #eef0f3',
              background: '#fff',
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
            }}
          >
            <AdjustmentDetail
              key={selectedId}
              orgId={orgId}
              adjustmentId={selectedId}
              onClose={close}
            />
          </div>
        )}
      </div>
    </div>
  );
}
