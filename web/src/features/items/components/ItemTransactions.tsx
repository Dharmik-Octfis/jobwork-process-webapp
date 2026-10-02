import { useQuery } from '@tanstack/react-query';
import { Fragment, useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { itemsApi } from '../items.api';
import { useTrackingLabel, useBatchUnitLabel } from '../../../hooks/useTrackingLabel';
import { ItemAdjustmentsTable } from '../../inventory/adjustments/ItemAdjustmentsTable';
import {
  BatchUnitsCard,
  BatchUnitsToggle,
} from '../../../components/inventory/BatchUnitsBreakdown';

interface ItemTransactionsProps {
  orgId: string;
  itemId: string;
}

type TransactionFilter = 'Bills' | 'Issues' | 'Receives' | 'Inventory Adjustments';

interface TransactionRow {
  id: string;
  billDate?: string;
  issueDate?: string;
  receiptDate?: string;
  billId?: string;
  issueId?: string;
  receiptId?: string;
  billNumber?: string;
  issueNumber?: string;
  receiptNumber?: string;
  vendorName?: string;
  quantity?: number;
  rate?: number;
  amount?: number;
  status?: string;
  /** Issues and Receives only — a challan's takas of one batch are folded into one row. */
  batches?: TransactionBatch[];
}

interface TransactionBatch {
  batchId: string;
  batchRef: string | null;
  /** Receives only: accepted | rework. */
  kind?: string;
  qty: number;
  units: { batchUnitId: string; label: string; qty: number }[];
  untaggedQty: number;
}

export function ItemTransactions({ orgId, itemId }: ItemTransactionsProps) {
  const [page] = useState(1);
  const [perPage] = useState(25);
  const [filterBy, setFilterBy] = useState<TransactionFilter>('Bills');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const trackingLabel = useTrackingLabel();
  const unitLabel = useBatchUnitLabel();
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(() => new Set());
  const toggleUnits = (key: string) =>
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const showBatchColumn = filterBy !== 'Bills';
  const hasUnits = (batch: TransactionBatch) => unitLabel.enabled && batch.units.length > 0;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const { data: billsData, isLoading: isLoadingBills } = useQuery({
    queryKey: ['itemBills', orgId, itemId, page, perPage],
    queryFn: () => itemsApi.fetchItemBills(orgId, itemId, { page, perPage }),
    enabled: Boolean(orgId && itemId) && filterBy === 'Bills',
  });

  const { data: issuesData, isLoading: isLoadingIssues } = useQuery({
    queryKey: ['itemIssues', orgId, itemId, page, perPage],
    queryFn: () => itemsApi.fetchItemIssues(orgId, itemId, { page, perPage }),
    enabled: Boolean(orgId && itemId) && filterBy === 'Issues',
  });

  const { data: receiptsData, isLoading: isLoadingReceipts } = useQuery({
    queryKey: ['itemReceipts', orgId, itemId, page, perPage],
    queryFn: () => itemsApi.fetchItemReceipts(orgId, itemId, { page, perPage }),
    enabled: Boolean(orgId && itemId) && filterBy === 'Receives',
  });

  const data = filterBy === 'Bills' ? billsData : filterBy === 'Issues' ? issuesData : receiptsData;
  const isLoading =
    filterBy === 'Bills'
      ? isLoadingBills
      : filterBy === 'Issues'
        ? isLoadingIssues
        : isLoadingReceipts;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      {/* Filters row */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          padding: '16px 24px',
          borderBottom: '1px solid #e2e8f0',
          background: '#f8fafc',
        }}
      >
        <div ref={filterRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 12px',
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              fontSize: '13px',
              color: '#1e293b',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Filter By: <span>{filterBy}</span>
            <ChevronDown
              size={14}
              style={{
                color: '#64748b',
                transform: isFilterOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
              }}
            />
          </button>

          {isFilterOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: '4px',
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                minWidth: '150px',
                zIndex: 10,
                overflow: 'hidden',
              }}
            >
              {['Bills', 'Issues', 'Receives', 'Inventory Adjustments'].map((option) => (
                <button
                  key={option}
                  onClick={() => {
                    setFilterBy(option as TransactionFilter);
                    setIsFilterOpen(false);
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '8px 12px',
                    textAlign: 'left',
                    background: filterBy === option ? '#f8fafc' : '#fff',
                    border: 'none',
                    fontSize: '13px',
                    color: filterBy === option ? '#2563eb' : '#1e293b',
                    cursor: 'pointer',
                    fontWeight: filterBy === option ? 500 : 400,
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={(e) => {
                    if (filterBy !== option) e.currentTarget.style.background = '#f1f5f9';
                  }}
                  onMouseLeave={(e) => {
                    if (filterBy !== option) e.currentTarget.style.background = '#fff';
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 12px',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            fontSize: '13px',
            color: '#1e293b',
            cursor: 'pointer',
          }}
        >
          Status: <span style={{ fontWeight: 500 }}>All</span>
          <ChevronDown size={14} />
        </button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {filterBy === 'Inventory Adjustments' ? (
          <ItemAdjustmentsTable orgId={orgId} itemId={itemId} />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead
              style={{
                position: 'sticky',
                top: 0,
                background: '#f8fafc',
                borderBottom: '1px solid #e2e8f0',
                zIndex: 1,
              }}
            >
              <tr>
                <th
                  style={{
                    padding: '12px 24px',
                    textAlign: 'left',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#64748b',
                    whiteSpace: 'nowrap',
                  }}
                >
                  DATE
                </th>
                <th
                  style={{
                    padding: '12px 24px',
                    textAlign: 'left',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#64748b',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {filterBy === 'Bills' ? 'BILL#' : filterBy === 'Issues' ? 'ISSUE#' : 'RECEIPT#'}
                </th>
                <th
                  style={{
                    padding: '12px 24px',
                    textAlign: 'left',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#64748b',
                    whiteSpace: 'nowrap',
                  }}
                >
                  VENDOR NAME
                </th>
                {showBatchColumn && (
                  <th
                    style={{
                      padding: '12px 24px',
                      textAlign: 'left',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#64748b',
                      whiteSpace: 'nowrap',
                      textTransform: 'uppercase',
                    }}
                  >
                    {trackingLabel.singular}
                  </th>
                )}
                <th
                  style={{
                    padding: '12px 24px',
                    textAlign: 'right',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#64748b',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {filterBy === 'Bills'
                    ? 'QUANTITY PURCHASED'
                    : filterBy === 'Issues'
                      ? 'QUANTITY ISSUED'
                      : 'QUANTITY RECEIVED'}
                </th>
                {filterBy === 'Bills' && (
                  <>
                    <th
                      style={{
                        padding: '12px 24px',
                        textAlign: 'right',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#64748b',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      PRICE
                    </th>
                    <th
                      style={{
                        padding: '12px 24px',
                        textAlign: 'right',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#64748b',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      TOTAL
                    </th>
                  </>
                )}
                <th
                  style={{
                    padding: '12px 24px',
                    textAlign: 'left',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#64748b',
                    whiteSpace: 'nowrap',
                  }}
                >
                  STATUS
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={7}
                    style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}
                  >
                    Loading transactions...
                  </td>
                </tr>
              ) : data?.results.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}
                  >
                    No transactions found.
                  </td>
                </tr>
              ) : (
                data?.results.map((row: TransactionRow) => {
                  const openBatches = showBatchColumn
                    ? (row.batches ?? []).filter(
                        (batch) =>
                          hasUnits(batch) && expandedUnits.has(`${row.id}:${batch.batchId}`),
                      )
                    : [];
                  return (
                    <Fragment key={row.id}>
                      <tr
                        style={{
                          borderBottom: openBatches.length ? 'none' : '1px solid #e2e8f0',
                          verticalAlign: 'top',
                        }}
                      >
                        <td style={{ padding: '12px 24px', fontSize: '13px', color: '#1e293b' }}>
                          {filterBy === 'Bills'
                            ? row.billDate
                              ? format(new Date(row.billDate), 'dd/MM/yyyy')
                              : '-'
                            : filterBy === 'Issues'
                              ? row.issueDate
                                ? format(new Date(row.issueDate), 'dd/MM/yyyy')
                                : '-'
                              : row.receiptDate
                                ? format(new Date(row.receiptDate), 'dd/MM/yyyy')
                                : '-'}
                        </td>
                        <td style={{ padding: '12px 24px', fontSize: '13px', color: '#2563eb' }}>
                          {filterBy === 'Bills' ? (
                            row.billId ? (
                              <Link
                                to={`/organizations/${orgId}/purchases/bills?id=${row.billId}`}
                                style={{ color: '#2563eb', textDecoration: 'none' }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.textDecoration = 'underline')
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.textDecoration = 'none')
                                }
                              >
                                {row.billNumber}
                              </Link>
                            ) : (
                              row.billNumber
                            )
                          ) : filterBy === 'Issues' ? (
                            row.issueId ? (
                              <Link
                                to={`/organizations/${orgId}/jobwork/issues?id=${row.issueId}`}
                                style={{ color: '#2563eb', textDecoration: 'none' }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.textDecoration = 'underline')
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.textDecoration = 'none')
                                }
                              >
                                {row.issueNumber}
                              </Link>
                            ) : (
                              row.issueNumber
                            )
                          ) : row.receiptId ? (
                            <Link
                              to={`/organizations/${orgId}/jobwork/receipts?id=${row.receiptId}`}
                              style={{ color: '#2563eb', textDecoration: 'none' }}
                              onMouseEnter={(e) =>
                                (e.currentTarget.style.textDecoration = 'underline')
                              }
                              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                            >
                              {row.receiptNumber}
                            </Link>
                          ) : (
                            row.receiptNumber
                          )}
                        </td>
                        <td style={{ padding: '12px 24px', fontSize: '13px', color: '#1e293b' }}>
                          {row.vendorName || '-'}
                        </td>
                        {showBatchColumn && (
                          <td
                            style={{
                              padding: '12px 24px',
                              fontSize: '13px',
                              color: '#1e293b',
                            }}
                          >
                            {!row.batches?.length
                              ? '-'
                              : row.batches.map((batch) => {
                                  const key = `${row.id}:${batch.batchId}`;
                                  const open = expandedUnits.has(key);
                                  return (
                                    <div key={batch.batchId}>
                                      <div style={{ whiteSpace: 'nowrap' }}>
                                        {batch.kind === 'rework' && (
                                          <span
                                            title="Rework"
                                            style={{ color: '#b45309', marginRight: 4 }}
                                          >
                                            ↻
                                          </span>
                                        )}
                                        {batch.batchRef ?? '-'}
                                        {/* Several batches share one row's quantity, so say the split. */}
                                        {row.batches!.length > 1 && (
                                          <span style={{ color: '#94a3b8' }}> · {batch.qty}</span>
                                        )}
                                      </div>
                                      {hasUnits(batch) && (
                                        <BatchUnitsToggle
                                          count={batch.units.length}
                                          open={open}
                                          onToggle={() => toggleUnits(key)}
                                          singular={unitLabel.singular}
                                          plural={unitLabel.plural}
                                        />
                                      )}
                                    </div>
                                  );
                                })}
                          </td>
                        )}
                        <td
                          style={{
                            padding: '12px 24px',
                            fontSize: '13px',
                            color: '#1e293b',
                            textAlign: 'right',
                          }}
                        >
                          {row.quantity}
                        </td>
                        {filterBy === 'Bills' && (
                          <>
                            <td
                              style={{
                                padding: '12px 24px',
                                fontSize: '13px',
                                color: '#1e293b',
                                textAlign: 'right',
                              }}
                            >
                              ₹{row.rate?.toFixed(2) || '0.00'}
                            </td>
                            <td
                              style={{
                                padding: '12px 24px',
                                fontSize: '13px',
                                color: '#1e293b',
                                textAlign: 'right',
                              }}
                            >
                              ₹{row.amount?.toFixed(2) || '0.00'}
                            </td>
                          </>
                        )}
                        <td style={{ padding: '12px 24px', fontSize: '13px' }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '12px',
                              fontSize: '12px',
                              background: row.status === 'Draft' ? '#f1f5f9' : '#dcfce7',
                              color: row.status === 'Draft' ? '#475569' : '#166534',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {row.status}
                          </span>
                        </td>
                      </tr>
                      {/* Its own row, starting under the batch column, so opening the
                    takas never changes a column's width. */}
                      {openBatches.length > 0 && (
                        <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                          <td colSpan={3} />
                          <td colSpan={3} style={{ padding: '0 24px 12px' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              {openBatches.map((batch) => (
                                <BatchUnitsCard
                                  key={batch.batchId}
                                  units={batch.units}
                                  untaggedQty={batch.untaggedQty}
                                  singular={unitLabel.singular}
                                  heading={
                                    row.batches!.length > 1
                                      ? (batch.batchRef ?? undefined)
                                      : undefined
                                  }
                                />
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
