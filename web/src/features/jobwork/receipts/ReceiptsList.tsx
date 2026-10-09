import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { PackageCheck, Plus, SlidersHorizontal, MoreVertical, Download } from 'lucide-react';
import { CustomizeColumnsModal } from '../../../components/ui/CustomizeColumnsModal';
import { ListFilterDropdown } from '../../../components/ui/ListFilterDropdown';
import { Pagination } from '../../../components/ui/Pagination';
import { BulkActionBar } from '../../../components/ui/BulkActionBar';
import { useListColumns } from '../../../hooks/useListColumns';
import { useListCount } from '../../../hooks/useListCount';
import { useListRowRetention } from '../../../hooks/useListRowRetention';
import { useListSearch } from '../../../hooks/useListSearch';
import { formatDate } from '../../../lib/formatDate';
import { notify } from '../../../lib/notify';
import { useActiveCustomFields } from '../../custom-fields/customFields.api';
import { formatCustomFieldValue } from '../../custom-fields/formatCustomFieldValue';
import type { CustomFieldDefinition } from '../../custom-fields/customFields.schemas';
import { CUSTOM_FIELD_PREFIX } from '../../list-views/listViews.api';
import { RECEIPT_STATUS_META, formatQty, itemSummary, statusMeta } from '../jobwork.schemas';
import { fetchJobReceiptCount, fetchJobReceipts, fetchReceiptsForStep } from './jobReceipts.api';
import { exportJobReceiptsToExcel, fetchAllJobReceiptsForExport } from './utils/exportJobReceipts';
import { ReceiptDetail } from './ReceiptDetail';
import type { JobReceipt } from './jobReceipts.schemas';

const headerStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontWeight: 600,
  fontSize: 11,
  color: '#64748b',
  textTransform: 'uppercase',
};

function StatusPill({ status }: { status: string }) {
  const meta = statusMeta(RECEIPT_STATUS_META, status);
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
  receipt: JobReceipt,
  key: string,
  customFieldDefs: CustomFieldDefinition[],
): React.ReactNode {
  if (key.startsWith(CUSTOM_FIELD_PREFIX)) {
    const cfKey = key.slice(CUSTOM_FIELD_PREFIX.length);
    return formatCustomFieldValue(
      receipt.customFields?.[cfKey],
      customFieldDefs.find((d) => d.key === cfKey),
    );
  }

  /* 🔴 The six totals are the PRIMARY output's, in its own unit — so the unit
     comes off that row, not off a header column (dropped 2026-08-12). */
  const primary = receipt.outputs?.find((row) => row.isPrimary) ?? receipt.outputs?.[0];
  const unit = primary?.uom ? (primary.uom.symbol ?? primary.uom.unitName) : '';

  switch (key) {
    case 'jobOrderNumber':
      return receipt.jobOrder?.jobOrderNumber ?? '-';
    case 'processorName':
      return receipt.processorNameSnapshot ?? 'In-house';
    case 'outputItem':
      // Every item that came back, counted. A receipt returns shirts AND rejects.
      return itemSummary(receipt.outputs ?? []);
    case 'status':
      // A pill, matching the Issues list. It was a bare `cancelled ? … : 'Posted'`
      // ternary, which labelled a draft "Posted" — the one thing it is not.
      return <StatusPill status={receipt.status} />;
    case 'totalReworkQty':
    case 'totalScrapQty':
    case 'totalReturnedQty':
      return `${formatQty(receipt[key])} ${unit}`.trim();
    case 'receiptDate':
    case 'createdAt':
      return formatDate(receipt[key] as string);
    default: {
      const value = (receipt as unknown as Record<string, unknown>)[key];
      if (value === null || value === undefined || value === '') return '-';
      return String(value);
    }
  }
}

export function ReceiptsList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');
  const stepId = searchParams.get('stepId');

  const { search, filter, setFilter, perPage, setPerPage, page, setPage } = useListSearch('all');

  const structuralSharing = useListRowRetention(
    ['job-receipts', orgId],
    `${search}|${filter}|${page}|${perPage}|${stepId ?? ''}`,
  );
  const { data: pageData, isLoading: pageLoading } = useQuery({
    queryKey: ['job-receipts', orgId, search, filter, page, perPage],
    queryFn: () => fetchJobReceipts(orgId!, { search: search || undefined, filter, page, perPage }),
    enabled: Boolean(orgId) && !stepId,
    placeholderData: (prev) => prev,
    structuralSharing,
  });

  const { data: stepReceipts, isLoading: stepLoading } = useQuery({
    queryKey: ['job-receipts', orgId, 'step', stepId],
    queryFn: () => fetchReceiptsForStep(orgId!, stepId!),
    enabled: Boolean(orgId && stepId),
  });

  const receipts = stepId ? (stepReceipts ?? []) : (pageData?.results ?? []);
  const isLoading = stepId ? stepLoading : pageLoading;

  const {
    total,
    isCounting,
    request: requestCount,
  } = useListCount(['job-receipts-count', orgId, search, filter], () =>
    fetchJobReceiptCount(orgId!, { search: search || undefined, filter }),
  );

  const {
    catalog,
    visible,
    filters,
    columns,
    save: saveColumns,
  } = useListColumns(orgId, 'job_receipt');
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
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
      notify.info('Preparing receipts for export...');
      const allReceipts = await fetchAllJobReceiptsForExport(orgId, {
        jobOrderNumber: search || undefined,
      });

      if (allReceipts.length === 0) {
        notify.error('No receipts found to export.');
        return;
      }

      exportJobReceiptsToExcel({
        rows: allReceipts,
        filename: `Jobwork_Receipt_Register_${new Date().toISOString().split('T')[0]}`,
        format: 'xlsx',
      });
      notify.success(`Successfully exported ${allReceipts.length} receipt records as XLSX file.`);
    } catch (err) {
      console.error('Failed to export receipts:', err);
      notify.error('Failed to export receipts. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportSelected = () => {
    const selectedReceipts = receipts.filter((r) => selectedIds.includes(r.id));
    if (selectedReceipts.length === 0) {
      notify.error('No selected receipts to export.');
      return;
    }
    exportJobReceiptsToExcel({
      receipts: selectedReceipts,
      filename: `Jobwork_Receipts_Selected_${new Date().toISOString().split('T')[0]}`,
      format: 'xlsx',
    });
    notify.success(
      `Successfully exported ${selectedReceipts.length} selected receipt(s) as XLSX file.`,
    );
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const toggleAll = () => {
    if (selectedIds.length === receipts.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(receipts.map((r) => r.id));
    }
  };

  // The `cf:` columns carry no type in the catalog, so the definitions are what
  // turn a stored option id or `YYYY-MM-DD` into something readable.
  const { data: customFieldDefs = [] } = useActiveCustomFields(orgId, 'job_receipt');

  const openDetail = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('id', id);
    setSearchParams(next);
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
            borderRight: selectedId ? '1px solid #eef0f3' : 'none',
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
          }}
        >
          {!selectedId && !stepId && selectedIds.length > 0 ? (
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
                padding: '16px 24px',
                borderBottom: '1px solid #eef0f3',
              }}
            >
              {stepId ? (
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
                    Receipts for one step
                  </span>
                  <button
                    type="button"
                    onClick={() => setSearchParams((prev) => { prev.delete('id'); return prev; })}
                    style={{
                      marginLeft: 12,
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      font: 'inherit',
                      fontSize: 12,
                      color: '#0062ff',
                      cursor: 'pointer',
                    }}
                  >
                    Show all receipts
                  </button>
                </div>
              ) : (
                <ListFilterDropdown
                  filters={filters}
                  value={filter}
                  onChange={setFilter}
                  fallbackLabel="All Receipts"
                />
              )}

              {!selectedId && !stepId && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
                  <button
                    type="button"
                    onClick={() =>
                      navigate(`/organizations/${orgId}/jobwork/receipts/new`, {
                        state: { returnUrl: location.pathname + location.search },
                      })
                    }
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
                    }}
                  >
                    <Plus size={16} /> New
                  </button>

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
                          Export Receipts (XLSX)
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </header>
          )}

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
                Loading receipts…
              </div>
            ) : receipts.length === 0 ? (
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
                  <PackageCheck size={36} color="#94a3b8" />
                </div>
                <h2
                  style={{ fontSize: 20, fontWeight: 600, color: '#1e293b', margin: '0 0 8px 0' }}
                >
                  Nothing Received Yet
                </h2>
                <p style={{ color: '#64748b', maxWidth: 440, margin: 0, lineHeight: 1.5 }}>
                  Receipts are posted from a job order, against the challans that are still out.
                  Open a job order and press Receive on a step that has material with a processor.
                </p>
              </div>
            ) : selectedId ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {receipts.map((receipt) => (
                  <button
                    key={receipt.id}
                    type="button"
                    onClick={() => openDetail(receipt.id)}
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
                      background: selectedId === receipt.id ? '#f1f5f9' : 'transparent',
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
                        {receipt.receiptNumber}
                      </span>
                      <StatusPill status={receipt.status} />
                    </span>
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      {formatQty(receipt.totalAcceptedQty)} accepted of{' '}
                      {formatQty(receipt.totalReceivedQty)}
                    </span>
                  </button>
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
                          checked={receipts.length > 0 && selectedIds.length === receipts.length}
                          onChange={toggleAll}
                          style={{ cursor: 'pointer' }}
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
                    {receipts.map((receipt) => (
                      <tr
                        key={receipt.id}
                        onClick={() => openDetail(receipt.id)}
                        style={{
                          borderBottom: '1px solid #eef0f3',
                          cursor: 'pointer',
                          background: selectedIds.includes(receipt.id) ? '#f8fafc' : 'transparent',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                        onMouseLeave={(e) => {
                          if (!selectedIds.includes(receipt.id)) {
                            e.currentTarget.style.background = 'transparent';
                          }
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
                            checked={selectedIds.includes(receipt.id)}
                            onChange={() => toggleSelection(receipt.id)}
                            style={{ cursor: 'pointer' }}
                          />
                        </td>
                        {columns.map((col) => (
                          <td
                            key={col.key}
                            style={{ padding: '12px 16px', fontSize: 13, color: '#333' }}
                          >
                            {col.locked ? (
                              <button
                                type="button"
                                onClick={() => openDetail(receipt.id)}
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
                                {renderCell(receipt, col.key, customFieldDefs)}
                              </button>
                            ) : (
                              renderCell(receipt, col.key, customFieldDefs)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {!stepId && (
            <Pagination
              pageContext={pageData?.pageContext}
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
            <ReceiptDetail
              receiptId={selectedId}
              onClose={() => {
                if (location.state?.returnUrl) {
                  navigate(location.state.returnUrl);
                } else {
                  const next = new URLSearchParams(searchParams);
                  next.delete('id');
                  setSearchParams(next);
                }
              }}
              onOpenJobOrder={(jobOrderId) =>
                navigate(`/organizations/${orgId}/jobwork/job-orders/${jobOrderId}`)
              }
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
