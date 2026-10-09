import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Send, SlidersHorizontal, MoreVertical, Download } from 'lucide-react';
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
import { ISSUE_STATUS_META, formatQty, statusMeta } from '../jobwork.schemas';
import { fetchIssuesForStep, fetchJobIssueCount, fetchJobIssues } from './jobIssues.api';
import { exportJobChallansToExcel, fetchAllJobChallansForExport } from './utils/exportJobIssues';
import { IssueDetail } from './IssueDetail';
import type { JobIssue } from './jobIssues.schemas';

const headerStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontWeight: 600,
  fontSize: 11,
  color: '#64748b',
  textTransform: 'uppercase',
};

function StatusPill({ status }: { status: string }) {
  const meta = statusMeta(ISSUE_STATUS_META, status);
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
  issue: JobIssue,
  key: string,
  customFieldDefs: CustomFieldDefinition[],
): React.ReactNode {
  if (key.startsWith(CUSTOM_FIELD_PREFIX)) {
    const cfKey = key.slice(CUSTOM_FIELD_PREFIX.length);
    return formatCustomFieldValue(
      issue.customFields?.[cfKey],
      customFieldDefs.find((d) => d.key === cfKey),
    );
  }

  switch (key) {
    case 'status':
      return <StatusPill status={issue.status} />;
    case 'jobOrderNumber':
      return issue.jobOrder?.jobOrderNumber ?? '-';
    case 'processName':
      return issue.step?.processNameSnapshot ?? '-';
    case 'processorName':
      return issue.processorNameSnapshot ?? 'In-house';
    case 'sourceLocation':
      return issue.sourceLocation?.name ?? '-';
    case 'destinationLocation':
      return issue.destination?.name ?? '-';
    case 'isRework':
      return issue.isRework ? `Rework #${issue.attemptNo}` : 'No';
    case 'issueDate':
    case 'createdAt':
      return formatDate(issue[key] as string);
    default: {
      const value = (issue as unknown as Record<string, unknown>)[key];
      if (value === null || value === undefined || value === '') return '-';
      return String(value);
    }
  }
}

/**
 * Challans out.
 *
 * `?stepId=` switches the page into "every challan against this step" — the
 * Overview page's "2 issues" link. It is a different question from the paginated
 * list (a step has a handful, read together), so it is a different query rather
 * than a filter preset.
 */
export function IssuesList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');
  const stepId = searchParams.get('stepId');

  const { search, filter, setFilter, perPage, setPerPage, page, setPage } = useListSearch('all');

  const structuralSharing = useListRowRetention(
    ['job-issues', orgId],
    `${search}|${filter}|${page}|${perPage}|${stepId ?? ''}`,
  );
  const { data: pageData, isLoading: pageLoading } = useQuery({
    queryKey: ['job-issues', orgId, search, filter, page, perPage],
    queryFn: () => fetchJobIssues(orgId!, { search: search || undefined, filter, page, perPage }),
    enabled: Boolean(orgId) && !stepId,
    placeholderData: (prev) => prev,
    structuralSharing,
  });

  const { data: stepIssues, isLoading: stepLoading } = useQuery({
    queryKey: ['job-issues', orgId, 'step', stepId],
    queryFn: () => fetchIssuesForStep(orgId!, stepId!),
    enabled: Boolean(orgId && stepId),
  });

  const issues = stepId ? (stepIssues ?? []) : (pageData?.results ?? []);
  const isLoading = stepId ? stepLoading : pageLoading;

  const {
    total,
    isCounting,
    request: requestCount,
  } = useListCount(['job-issues-count', orgId, search, filter], () =>
    fetchJobIssueCount(orgId!, { search: search || undefined, filter }),
  );

  const {
    catalog,
    visible,
    filters,
    columns,
    save: saveColumns,
  } = useListColumns(orgId, 'job_issue');
  // `cf:` columns carry no type in the catalog; the definitions format them.
  const { data: customFieldDefs = [] } = useActiveCustomFields(orgId!, 'job_issue');
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
      notify.info('Preparing challans for export...');
      const allChallans = await fetchAllJobChallansForExport(orgId, {
        jobOrderNumber: search || undefined,
      });

      if (allChallans.length === 0) {
        notify.error('No challans found to export.');
        return;
      }

      exportJobChallansToExcel({
        rows: allChallans,
        filename: `Jobwork_Challan_Register_${new Date().toISOString().split('T')[0]}`,
        format: 'xlsx',
      });
      notify.success(`Successfully exported ${allChallans.length} challan records as XLSX file.`);
    } catch (err) {
      console.error('Failed to export challans:', err);
      notify.error('Failed to export challans. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportSelected = () => {
    const selectedIssues = issues.filter((i) => selectedIds.includes(i.id));
    if (selectedIssues.length === 0) {
      notify.error('No selected challans to export.');
      return;
    }
    exportJobChallansToExcel({
      issues: selectedIssues,
      filename: `Jobwork_Challans_Selected_${new Date().toISOString().split('T')[0]}`,
      format: 'xlsx',
    });
    notify.success(
      `Successfully exported ${selectedIssues.length} selected challan(s) as XLSX file.`,
    );
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const toggleAll = () => {
    if (selectedIds.length === issues.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(issues.map((i) => i.id));
    }
  };

  const openDetail = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('id', id);
    setSearchParams(next);
  };
  const closeDetail = () => {
    if (location.state?.returnUrl) {
      navigate(location.state.returnUrl);
    } else {
      const next = new URLSearchParams(searchParams);
      next.delete('id');
      setSearchParams(next);
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
                    Challans for one step
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setSearchParams((prev) => {
                        prev.delete('id');
                        return prev;
                      })
                    }
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
                    Show all challans
                  </button>
                </div>
              ) : (
                <ListFilterDropdown
                  filters={filters}
                  value={filter}
                  onChange={setFilter}
                  fallbackLabel="All Challans"
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
                      navigate(`/organizations/${orgId}/jobwork/issues/new`, {
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
                          Export Challans (XLSX)
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
                Loading challans…
              </div>
            ) : issues.length === 0 ? (
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
                  <Send size={36} color="#94a3b8" />
                </div>
                <h2
                  style={{ fontSize: 20, fontWeight: 600, color: '#1e293b', margin: '0 0 8px 0' }}
                >
                  Nothing Issued Yet
                </h2>
                <p style={{ color: '#64748b', maxWidth: 440, margin: 0, lineHeight: 1.5 }}>
                  Challans are raised from a job order — open one and press Issue on the step that
                  is ready. They cannot be created on their own, because a challan without a step
                  has no process, no rate and nothing to come back to.
                </p>
              </div>
            ) : selectedId ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {issues.map((issue) => (
                  <button
                    key={issue.id}
                    type="button"
                    onClick={() => openDetail(issue.id)}
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
                      background: selectedId === issue.id ? '#f1f5f9' : 'transparent',
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
                        {issue.challanNumber}
                      </span>
                      <StatusPill status={issue.status} />
                    </span>
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      {issue.processorNameSnapshot ?? 'In-house'} · {formatQty(issue.totalQty)}
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
                          checked={issues.length > 0 && selectedIds.length === issues.length}
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
                    {issues.map((issue) => (
                      <tr
                        key={issue.id}
                        onClick={() => openDetail(issue.id)}
                        style={{
                          borderBottom: '1px solid #eef0f3',
                          cursor: 'pointer',
                          background: selectedIds.includes(issue.id) ? '#f8fafc' : 'transparent',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                        onMouseLeave={(e) => {
                          if (!selectedIds.includes(issue.id)) {
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
                            checked={selectedIds.includes(issue.id)}
                            onChange={() => toggleSelection(issue.id)}
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
                                onClick={() => openDetail(issue.id)}
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
                                {renderCell(issue, col.key, customFieldDefs)}
                              </button>
                            ) : (
                              renderCell(issue, col.key, customFieldDefs)
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
            <IssueDetail issueId={selectedId} onClose={closeDetail} />
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
