import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, MoreVertical, Download } from 'lucide-react';
import { useListSearch } from '../../../hooks/useListSearch';
import { useListCount } from '../../../hooks/useListCount';
import { Pagination } from '../../../components/ui/Pagination';
import { NewButton } from '../../../components/ui/NewButton';
import { BulkActionBar } from '../../../components/ui/BulkActionBar';
import { formatDate } from '../../../lib/formatDate';
import { notify } from '../../../lib/notify';
import { formatMoney, formatQty, toNumber } from '../../jobwork/jobwork.schemas';
import { AdjustmentDetail } from './AdjustmentDetail';
import { fetchAdjustmentCount, fetchAdjustments } from './adjustments.api';
import {
  adjustmentTypeLabel,
  adjustmentStatusMeta,
  type StockAdjustmentRow,
} from './adjustments.schemas';
import {
  exportAdjustmentsToExcel,
  fetchAllAdjustmentsForExport,
} from './utils/exportAdjustments';

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
  const meta = adjustmentStatusMeta(status);
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
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  );
}

/** "Grey Fabric", or "Grey Fabric +2 more" — the row is one document, however many items. */
function itemsOf(row: StockAdjustmentRow): string {
  const [first, ...rest] = row.lines;
  if (!first) return '-';
  return rest.length > 0 ? `${first.item.name} +${rest.length} more` : first.item.name;
}

/** A single item's signed quantity or value; several items have no one figure to show. */
function QuantityCell({ row }: { row: StockAdjustmentRow }) {
  if (row.lines.length !== 1)
    return <span style={{ color: '#64748b' }}>{row.lines.length} items</span>;
  if (row.adjustmentType === 'value') {
    const value = toNumber(row.lines[0]!.valueAdjusted);
    return (
      <span style={{ color: value > 0 ? '#166534' : '#b91c1c', fontWeight: 500 }}>
        {value > 0 ? '+' : '−'}
        {formatMoney(Math.abs(value))}
      </span>
    );
  }
  const quantity = toNumber(row.lines[0]!.quantityAdjusted);
  return (
    <span style={{ color: quantity > 0 ? '#166534' : '#b91c1c', fontWeight: 500 }}>
      {quantity > 0 ? '+' : '−'}
      {formatQty(Math.abs(quantity))}
    </span>
  );
}

/**
 * Inventory → Inventory Adjustments: every stock adjustment, drafts and cancelled ones
 * included. New opens the full form; the Adjust Stock button on an item's page
 * is the one-item shortcut to the same document.
 */
export function AdjustmentsList() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');
  const { search, perPage, setPerPage, page, setPage } = useListSearch();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    if (isMoreMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMoreMenuOpen]);

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

  const handleExportAll = async () => {
    setIsExporting(true);
    try {
      notify.success('Exporting adjustments to XLSX...');
      const allAdjustments = await fetchAllAdjustmentsForExport(orgId!, {});
      if (allAdjustments.length === 0) {
        notify.error('No adjustments found to export.');
        return;
      }
      exportAdjustmentsToExcel({
        adjustments: allAdjustments,
        filename: `Inventory_Adjustments_${new Date().toISOString().split('T')[0]}`,
        format: 'xlsx',
      });
      notify.success(
        `Successfully exported ${allAdjustments.length} adjustments as XLSX file.`,
      );
    } catch (err) {
      console.error('Failed to export adjustments:', err);
      notify.error('Failed to export adjustments. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportSelected = () => {
    const selectedAdjustments = rows.filter((r) => selectedIds.includes(r.id));
    if (selectedAdjustments.length === 0) {
      notify.error('No selected adjustments to export.');
      return;
    }
    exportAdjustmentsToExcel({
      adjustments: selectedAdjustments,
      filename: `Inventory_Adjustments_Selected_${new Date().toISOString().split('T')[0]}`,
      format: 'xlsx',
    });
    notify.success(
      `Successfully exported ${selectedAdjustments.length} selected adjustments as XLSX file.`,
    );
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const toggleAll = () => {
    if (selectedIds.length === rows.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(rows.map((r) => r.id));
    }
  };

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
          Use New to adjust the stock of one or more items.
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
          {!selectedId && selectedIds.length > 0 ? (
            <BulkActionBar
              selectedCount={selectedIds.length}
              onClearSelection={() => setSelectedIds([])}
              onExport={handleExportSelected}
              isProcessing={isExporting}
            />
          ) : (
            <header
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                padding: '16px 24px',
                background: '#fff',
                borderBottom: '1px solid #eef0f3',
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 600, color: '#111', minWidth: 0 }}>
                Inventory Adjustments
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <NewButton
                  onClick={() => navigate(`/organizations/${orgId}/inventory/adjustments/new`)}
                />
                {!selectedId && (
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
                          Export Adjustments (XLSX)
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </header>
          )}

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
                    {itemsOf(row)}
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
                          checked={rows.length > 0 && selectedIds.length === rows.length}
                          onChange={toggleAll}
                          style={{ cursor: 'pointer' }}
                        />
                      </th>
                      <th style={headerStyle}>Date</th>
                      <th style={headerStyle}>Adjustment#</th>
                      <th style={headerStyle}>Type</th>
                      <th style={headerStyle}>Items</th>
                      <th style={headerStyle}>Location</th>
                      <th style={{ ...headerStyle, textAlign: 'right' }}>Adjusted</th>
                      <th style={headerStyle}>Reason</th>
                      <th style={headerStyle}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => open(row.id)}
                        style={{
                          borderBottom: '1px solid #eef0f3',
                          cursor: 'pointer',
                          background: selectedIds.includes(row.id) ? '#f8fafc' : 'transparent',
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
                            checked={selectedIds.includes(row.id)}
                            onChange={() => toggleSelection(row.id)}
                            style={{ cursor: 'pointer' }}
                          />
                        </td>
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
                        <td style={cellStyle}>{adjustmentTypeLabel(row.adjustmentType)}</td>
                        <td style={cellStyle}>{itemsOf(row)}</td>
                        <td style={cellStyle}>{row.location.name}</td>
                        <td style={{ ...cellStyle, textAlign: 'right' }}>
                          <QuantityCell row={row} />
                        </td>
                        <td style={cellStyle}>{row.reason.name}</td>
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
