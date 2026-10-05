import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Send,
  SlidersHorizontal,
  Search,
  X,
  FileText,
  Clock,
  CheckCircle2,
  CircleSlash,
  Building2,
  Warehouse,
  RotateCw,
} from 'lucide-react';
import { CustomizeColumnsModal } from '../../../components/ui/CustomizeColumnsModal';
import { ListFilterDropdown } from '../../../components/ui/ListFilterDropdown';
import { Pagination } from '../../../components/ui/Pagination';
import { useListColumns } from '../../../hooks/useListColumns';
import { useListCount } from '../../../hooks/useListCount';
import { useListSearch } from '../../../hooks/useListSearch';
import { formatDate } from '../../../lib/formatDate';
import { ISSUE_STATUS_META, formatQty, statusMeta } from '../jobwork.schemas';
import { fetchIssuesForStep, fetchJobIssueCount, fetchJobIssues } from './jobIssues.api';
import { IssueDetail } from './IssueDetail';
import type { JobIssue } from './jobIssues.schemas';

const tableHeaderStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontWeight: 600,
  fontSize: 11,
  color: '#475569',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
};

function IssueStatusBadge({ status }: { status: string }) {
  const meta = statusMeta(ISSUE_STATUS_META, status);
  const getIcon = () => {
    switch (status) {
      case 'issued':
        return <CheckCircle2 size={12} />;
      case 'draft':
        return <Clock size={12} />;
      case 'cancelled':
        return <CircleSlash size={12} />;
      default:
        return null;
    }
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 10px',
        borderRadius: 12,
        fontSize: 11.5,
        fontWeight: 600,
        color: meta.color,
        background: meta.bg,
        border: `1px solid ${meta.color}25`,
        letterSpacing: '0.01em',
      }}
    >
      {getIcon()}
      <span>{meta.label}</span>
    </span>
  );
}

function renderCell(issue: JobIssue, key: string): React.ReactNode {
  switch (key) {
    case 'status':
      return <IssueStatusBadge status={issue.status} />;
    case 'jobOrderNumber':
      return issue.jobOrder?.jobOrderNumber ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontWeight: 500,
            color: '#1e293b',
          }}
        >
          {issue.jobOrder.jobOrderNumber}
        </span>
      ) : (
        '-'
      );
    case 'processName':
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 8px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 500,
            color: '#334155',
          }}
        >
          {issue.step ? `Step ${issue.step.seq}: ` : ''}
          {issue.step?.processNameSnapshot ?? '-'}
        </span>
      );
    case 'processorName':
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 12.5,
            color: '#1e293b',
            fontWeight: 500,
          }}
        >
          {issue.processorType === 'internal' ? (
            <>
              <Warehouse size={13} color="#0284c7" />
              <span>In-house</span>
            </>
          ) : (
            <>
              <Building2 size={13} color="#475569" />
              <span>{issue.processorNameSnapshot ?? 'Vendor'}</span>
            </>
          )}
        </span>
      );
    case 'sourceLocation':
      return (
        <span style={{ fontSize: 12.5, color: '#475569' }}>
          {issue.sourceLocation?.name ?? '-'}
        </span>
      );
    case 'destinationLocation':
      return (
        <span style={{ fontSize: 12.5, color: '#475569' }}>{issue.destination?.name ?? '-'}</span>
      );
    case 'totalQty':
      return (
        <span
          style={{
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 600,
            color: '#0f172a',
          }}
        >
          {formatQty(issue.totalQty)}
        </span>
      );
    case 'isRework':
      return issue.isRework ? (
        <span
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 600,
            background: '#fffbeb',
            color: '#b45309',
            border: '1px solid #fde68a',
          }}
        >
          Rework #{issue.attemptNo}
        </span>
      ) : (
        <span style={{ color: '#94a3b8' }}>No</span>
      );
    case 'issueDate':
    case 'createdAt':
      return (
        <span style={{ fontSize: 12, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
          {formatDate(issue[key] as string)}
        </span>
      );
    default: {
      const value = (issue as unknown as Record<string, unknown>)[key];
      if (value === null || value === undefined || value === '') return '-';
      return String(value);
    }
  }
}

/**
 * Material Issues (Challans Out) Module
 *
 * Provides comprehensive listing, filtering, search, metrics, and master-detail
 * inspection for delivery challans issued against Job Order process steps.
 */
export function IssuesList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');
  const stepId = searchParams.get('stepId');

  const { search, setSearch, filter, setFilter, perPage, setPerPage, page, setPage } =
    useListSearch('all');

  const [searchInput, setSearchInput] = useState(search || '');
  const [prevSearch, setPrevSearch] = useState(search);

  // Synchronize internal input when URL search changes
  if (search !== prevSearch) {
    setPrevSearch(search);
    setSearchInput(search || '');
  }

  // Debounced search query
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== search) {
        setSearch(searchInput);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, search, setSearch]);

  const {
    data: pageData,
    isLoading: pageLoading,
    isFetching: isPageFetching,
  } = useQuery({
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

  // Quick summary counts for KPI ribbon
  const { data: totalAllCount } = useQuery({
    queryKey: ['job-issues-kpi-all', orgId],
    queryFn: () => fetchJobIssueCount(orgId!, {}),
    enabled: Boolean(orgId) && !stepId,
    staleTime: 30000,
  });

  const { data: issuedCount } = useQuery({
    queryKey: ['job-issues-kpi-issued', orgId],
    queryFn: () => fetchJobIssueCount(orgId!, { filter: 'issued' }),
    enabled: Boolean(orgId) && !stepId,
    staleTime: 30000,
  });

  const { data: draftCount } = useQuery({
    queryKey: ['job-issues-kpi-draft', orgId],
    queryFn: () => fetchJobIssueCount(orgId!, { filter: 'draft' }),
    enabled: Boolean(orgId) && !stepId,
    staleTime: 30000,
  });

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

  const handleFilterSelect = (newFilter: string) => {
    setFilter(newFilter);
    setPage(1);
  };

  const clearAllFilters = () => {
    setSearchInput('');
    setSearch('');
    setFilter('all');
    setPage(1);
    if (stepId) {
      setSearchParams({});
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
      {/* Step Context Banner (when filtering by a specific job order step) */}
      {stepId && (
        <div
          style={{
            padding: '10px 24px',
            background: '#f0f9ff',
            borderBottom: '1px solid #bae6fd',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              color: '#0369a1',
            }}
          >
            <FileText size={16} />
            <span style={{ fontWeight: 600 }}>Showing challans for step:</span>
            <span>{issues[0]?.step?.processNameSnapshot ?? 'Selected Step'}</span>
            <span style={{ color: '#0284c7' }}>({issues.length} total)</span>
          </div>
          <button
            type="button"
            onClick={() => setSearchParams({})}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 500,
              color: '#0284c7',
              background: '#fff',
              border: '1px solid #bae6fd',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Show all challans
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div
        className={`master-detail-container ${selectedId ? 'has-selection' : ''}`}
        style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#f8fafc' }}
      >
        {/* Left Pane (Master List) */}
        <div
          className="master-pane"
          style={{
            flex: selectedId ? '0 0 340px' : 1,
            borderRight: selectedId ? '1px solid #e2e8f0' : 'none',
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
            transition: 'flex 0.15s ease',
          }}
        >
          {/* Header & Controls Toolbar */}
          <header
            style={{
              padding: '16px 24px',
              borderBottom: '1px solid #eef0f3',
              background: '#ffffff',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            {/* Top row: Filter Dropdown & Primary Action Buttons */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {!stepId ? (
                  <ListFilterDropdown
                    filters={filters}
                    value={filter}
                    onChange={handleFilterSelect}
                    fallbackLabel="All Challans"
                  />
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#1e293b' }}>
                    Challans for Step
                  </span>
                )}
                {isPageFetching && !isLoading && (
                  <RotateCw size={13} className="spin" color="#0284c7" title="Updating..." />
                )}
              </div>

              {!selectedId && !stepId && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setIsColumnsOpen(true)}
                    title="Customize Columns"
                    aria-label="Customize Columns"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 34,
                      height: 34,
                      borderRadius: 6,
                      border: '1px solid #e2e8f0',
                      background: '#fff',
                      cursor: 'pointer',
                      color: '#475569',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f8fafc';
                      e.currentTarget.style.borderColor = '#cbd5e1';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#fff';
                      e.currentTarget.style.borderColor = '#e2e8f0';
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
                      background: 'var(--color-primary, #0284c7)',
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
                      boxShadow: '0 1px 2px rgba(2, 132, 199, 0.2)',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(0.92)')}
                    onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
                  >
                    <Plus size={16} /> New Issue
                  </button>
                </div>
              )}
            </div>

            {/* Metrics Ribbon (When full list view is active and not in step mode) */}
            {!selectedId && !stepId && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: 10,
                  marginTop: 2,
                }}
              >
                <div
                  onClick={() => handleFilterSelect('all')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: filter === 'all' ? '#eff6ff' : '#f8fafc',
                    border: `1px solid ${filter === 'all' ? '#bfdbfe' : '#e2e8f0'}`,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: '#64748b',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                    }}
                  >
                    Total Issues
                  </div>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: '#0f172a',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {totalAllCount !== undefined ? totalAllCount : (total ?? '-')}
                  </div>
                </div>

                <div
                  onClick={() => handleFilterSelect('issued')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: filter === 'issued' ? '#eff6ff' : '#f8fafc',
                    border: `1px solid ${filter === 'issued' ? '#93c5fd' : '#e2e8f0'}`,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: '#1d4ed8',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <CheckCircle2 size={12} /> Issued / Out
                  </div>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: '#1d4ed8',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {issuedCount !== undefined ? issuedCount : '—'}
                  </div>
                </div>

                <div
                  onClick={() => handleFilterSelect('draft')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: filter === 'draft' ? '#f1f5f9' : '#f8fafc',
                    border: `1px solid ${filter === 'draft' ? '#cbd5e1' : '#e2e8f0'}`,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: '#475569',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Clock size={12} /> Drafts
                  </div>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: '#334155',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {draftCount !== undefined ? draftCount : '—'}
                  </div>
                </div>
              </div>
            )}

            {/* Search Input Bar */}
            {!stepId && (
              <div style={{ position: 'relative', width: '100%' }}>
                <Search
                  size={15}
                  style={{
                    position: 'absolute',
                    left: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#94a3b8',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search by challan #, processor, job order..."
                  style={{
                    width: '100%',
                    height: 34,
                    padding: '0 32px 0 32px',
                    fontSize: 13,
                    borderRadius: 6,
                    border: '1px solid #d1d5db',
                    background: '#fff',
                    outline: 'none',
                    color: '#1e293b',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-primary, #0284c7)';
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(2, 132, 199, 0.15)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = '#d1d5db';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput('');
                      setSearch('');
                    }}
                    style={{
                      position: 'absolute',
                      right: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: 2,
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )}
          </header>

          {/* List Content */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isLoading ? (
              <div
                style={{
                  padding: 48,
                  textAlign: 'center',
                  color: '#64748b',
                  fontSize: 13,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <RotateCw size={24} className="spin" color="#0284c7" />
                <span>Loading challans…</span>
              </div>
            ) : issues.length === 0 ? (
              /* Contextual Empty State */
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
                    background: '#f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 16,
                  }}
                >
                  <Send size={32} color="#94a3b8" />
                </div>
                <h3
                  style={{ fontSize: 17, fontWeight: 600, color: '#1e293b', margin: '0 0 8px 0' }}
                >
                  {searchInput || filter !== 'all'
                    ? 'No Matching Challans'
                    : 'No Material Issues Yet'}
                </h3>
                <p
                  style={{
                    color: '#64748b',
                    fontSize: 13,
                    maxWidth: 420,
                    margin: '0 0 20px 0',
                    lineHeight: 1.5,
                  }}
                >
                  {searchInput || filter !== 'all'
                    ? 'No material issue challans matched your active search term or filter preset.'
                    : 'Material issue challans document goods dispatched from your godown to processors for execution of Job Order steps.'}
                </p>
                {searchInput || filter !== 'all' ? (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    style={{
                      background: '#fff',
                      color: '#0284c7',
                      border: '1px solid #bae6fd',
                      padding: '7px 16px',
                      borderRadius: 6,
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    Clear Filters
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => navigate(`/organizations/${orgId}/jobwork/issues/new`)}
                    style={{
                      background: 'var(--color-primary, #0284c7)',
                      color: '#fff',
                      border: 'none',
                      padding: '8px 16px',
                      borderRadius: 6,
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Plus size={16} /> Create Material Issue
                  </button>
                )}
              </div>
            ) : selectedId ? (
              /* Compact Master Cards (Split View Mode) */
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {issues.map((issue) => {
                  const isSelected = selectedId === issue.id;
                  return (
                    <button
                      key={issue.id}
                      type="button"
                      onClick={() => openDetail(issue.id)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '12px 16px',
                        borderBottom: '1px solid #f1f5f9',
                        borderLeft: isSelected
                          ? '3px solid var(--color-primary, #0284c7)'
                          : '3px solid transparent',
                        borderRight: 'none',
                        borderTop: 'none',
                        cursor: 'pointer',
                        background: isSelected ? '#f0f9ff' : 'transparent',
                        font: 'inherit',
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.background = '#f8fafc';
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.background = 'transparent';
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
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                          {issue.challanNumber}
                        </span>
                        <IssueStatusBadge status={issue.status} />
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: 12,
                          color: '#64748b',
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {issue.processorType === 'internal' ? (
                            <Warehouse size={12} color="#0284c7" />
                          ) : (
                            <Building2 size={12} color="#64748b" />
                          )}
                          {issue.processorNameSnapshot ?? 'In-house'}
                        </span>
                        <span style={{ fontWeight: 600, color: '#334155' }}>
                          {formatQty(issue.totalQty)}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: '#94a3b8',
                          marginTop: 4,
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>{issue.jobOrder?.jobOrderNumber ?? 'Direct'}</span>
                        <span>{formatDate(issue.issueDate)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              /* Full Responsive Table View */
              <div className="responsive-table-wrapper">
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr
                      style={{
                        background: '#f8fafc',
                        borderTop: '1px solid #eef0f3',
                        borderBottom: '1px solid #e2e8f0',
                      }}
                    >
                      {columns.map((col) => (
                        <th key={col.key} style={tableHeaderStyle} scope="col">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {issues.map((issue, idx) => (
                      <tr
                        key={issue.id}
                        onClick={() => openDetail(issue.id)}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          cursor: 'pointer',
                          background: idx % 2 === 0 ? '#ffffff' : '#fafafa',
                          transition: 'background 0.12s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f9ff')}
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = idx % 2 === 0 ? '#ffffff' : '#fafafa')
                        }
                      >
                        {columns.map((col) => (
                          <td
                            key={col.key}
                            style={{
                              padding: '12px 16px',
                              fontSize: 13,
                              color: '#334155',
                              verticalAlign: 'middle',
                            }}
                          >
                            {col.locked ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDetail(issue.id);
                                }}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  padding: 0,
                                  font: 'inherit',
                                  fontWeight: 600,
                                  color: 'var(--color-primary, #0284c7)',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
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

          {/* Pagination Footer */}
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

        {/* Right Detail Pane */}
        {selectedId && (
          <div
            className="detail-pane"
            style={{
              flex: 1,
              overflowY: 'auto',
              background: '#ffffff',
            }}
          >
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
