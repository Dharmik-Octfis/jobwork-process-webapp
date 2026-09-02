import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Send, SlidersHorizontal } from 'lucide-react';
import { CustomizeColumnsModal } from '../../../components/ui/CustomizeColumnsModal';
import { ListFilterDropdown } from '../../../components/ui/ListFilterDropdown';
import { Pagination } from '../../../components/ui/Pagination';
import { useListColumns } from '../../../hooks/useListColumns';
import { useListCount } from '../../../hooks/useListCount';
import { useListSearch } from '../../../hooks/useListSearch';
import { formatDate } from '../../../lib/formatDate';
import {
  ISSUE_STATUS_META,
  formatQty,
  itemSummary,
  sharedUnit,
  statusMeta,
} from '../jobwork.schemas';
import { fetchIssuesForStep, fetchJobIssueCount, fetchJobIssues } from './jobIssues.api';
import { IssueDetail } from './IssueDetail';
import type { JobIssue } from './jobIssues.schemas';

const headerStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontWeight: 600,
  fontSize: 11,
  color: '#64748b',
  textTransform: 'uppercase',
};

// No `cf:` branch — `job_issue` is list-only since 2026-08-10, so the server
// merges no custom-field columns into this catalog. A `cf:` key left in someone's
// saved preferences falls through to the default and renders "-".
function renderCell(issue: JobIssue, key: string): React.ReactNode {
  switch (key) {
    case 'status': {
      const meta = statusMeta(ISSUE_STATUS_META, issue.status);
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
    case 'jobOrderNumber':
      return issue.jobOrder?.jobOrderNumber ?? '-';
    case 'processName':
      return issue.step?.processNameSnapshot ?? '-';
    case 'processorName':
      return issue.processorNameSnapshot ?? 'In-house';
    case 'item':
      // Every item on the challan, counted — the header column that named only
      // the principal one went on 2026-08-12.
      return itemSummary(issue.lines);
    case 'totalQty': {
      // No unit when the lines disagree: metres + cones + pieces is not a sum.
      const unit = sharedUnit(issue.lines);
      return `${formatQty(issue.totalQty)}${unit ? ` ${unit}` : ''}`;
    }
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

  const { data: pageData, isLoading: pageLoading } = useQuery({
    queryKey: ['job-issues', orgId, search, filter, page, perPage],
    queryFn: () => fetchJobIssues(orgId!, { search: search || undefined, filter, page, perPage }),
    enabled: Boolean(orgId) && !stepId,
    placeholderData: (prev) => prev,
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
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);

  const openDetail = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('id', id);
    setSearchParams(next);
  };
  const closeDetail = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('id');
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
      <div className={`master-detail-container ${selectedId ? 'has-selection' : ''}`} style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#f8fafc' }}>
        <div className="master-pane"
          style={{
            flex: selectedId ? '0 0 320px' : 1,
            borderRight: selectedId ? '1px solid #eef0f3' : 'none',
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
                  onClick={() => setSearchParams({})}
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
                fallbackLabel="Open Challans"
              />
            )}

            {!selectedId && !stepId && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
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
                  onClick={() => navigate(`/organizations/${orgId}/jobwork/issues/new`, { state: { returnUrl: location.pathname + location.search } })}
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
              </div>
            )}
          </header>

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
                        display: 'block',
                        fontSize: 13,
                        fontWeight: 500,
                        color: '#1e293b',
                        marginBottom: 4,
                      }}
                    >
                      {issue.challanNumber}
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
                    {columns.map((col) => (
                      <th key={col.key} style={headerStyle} scope="col">
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {issues.map((issue) => (
                    /**
                     * The whole row opens it. The LOCKED column stays a real
                     * `<button>` underneath: a row `onClick` is invisible to
                     * Tab, so this is the mouse convenience and the button is
                     * the control (CLAUDE.md).
                     */
                    <tr
                      key={issue.id}
                      onClick={() => openDetail(issue.id)}
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
                              {renderCell(issue, col.key)}
                            </button>
                          ) : (
                            renderCell(issue, col.key)
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

          {!selectedId && !stepId && (
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
