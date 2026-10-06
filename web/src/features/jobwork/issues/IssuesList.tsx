import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  ArrowRight,
  MapPin,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { CustomizeColumnsModal } from '../../../components/ui/CustomizeColumnsModal';
import { ListFilterDropdown } from '../../../components/ui/ListFilterDropdown';
import { Pagination } from '../../../components/ui/Pagination';
import { BulkActionBar } from '../../../components/ui/BulkActionBar';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useListColumns } from '../../../hooks/useListColumns';
import { useListCount } from '../../../hooks/useListCount';
import { useListSearch } from '../../../hooks/useListSearch';
import { formatDate } from '../../../lib/formatDate';
import { ISSUE_STATUS_META, formatQty, statusMeta } from '../jobwork.schemas';
import {
  fetchIssuesForStep,
  fetchJobIssueCount,
  fetchJobIssues,
  deleteJobIssue,
} from './jobIssues.api';
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

function IssueStatusBadge({ status, size = 'md' }: { status: string; size?: 'sm' | 'md' }) {
  const meta = statusMeta(ISSUE_STATUS_META, status);
  const isSm = size === 'sm';
  const getIcon = () => {
    switch (status) {
      case 'issued':
        return <CheckCircle2 size={isSm ? 10 : 12} />;
      case 'draft':
        return <Clock size={isSm ? 10 : 12} />;
      case 'cancelled':
        return <CircleSlash size={isSm ? 10 : 12} />;
      default:
        return null;
    }
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: isSm ? 3.5 : 5,
        padding: isSm ? '2px 7px' : '3px 10px',
        borderRadius: 12,
        fontSize: isSm ? 11 : 11.5,
        fontWeight: 600,
        color: meta.color,
        background: meta.bg,
        border: `1px solid ${meta.color}25`,
        letterSpacing: '0.01em',
        lineHeight: 1.2,
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
    case 'challanNumber':
      return (
        <span
          style={{
            fontWeight: 600,
            fontSize: 13,
            color: '#0284c7',
          }}
        >
          {issue.challanNumber}
        </span>
      );
    case 'jobOrderNumber':
      return issue.jobOrder?.jobOrderNumber ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontWeight: 600,
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
            gap: 6,
            fontSize: 12.5,
            color: '#1e293b',
            fontWeight: 500,
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: issue.processorType === 'internal' ? '#e0f2fe' : '#f3e8ff',
              color: issue.processorType === 'internal' ? '#0284c7' : '#7e22ce',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {issue.processorType === 'internal' ? <Warehouse size={12} /> : <Building2 size={12} />}
          </div>
          <span>
            {issue.processorNameSnapshot ??
              (issue.processorType === 'internal' ? 'In-house' : 'Vendor')}
          </span>
        </span>
      );
    case 'sourceLocation':
      return (
        <span
          style={{
            fontSize: 12.5,
            color: '#475569',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <Warehouse size={13} color="#94a3b8" />
          <span>{issue.sourceLocation?.name ?? '-'}</span>
        </span>
      );
    case 'destinationLocation':
      return (
        <span
          style={{
            fontSize: 12.5,
            color: '#475569',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <MapPin size={13} color="#94a3b8" />
          <span>{issue.destination?.name ?? '-'}</span>
        </span>
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

  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);

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

  const handleBulkDelete = async () => {
    setIsProcessing(true);
    let successCount = 0;
    let failedCount = 0;
    try {
      for (const id of selectedIds) {
        try {
          await deleteJobIssue(orgId!, id);
          successCount++;
        } catch {
          failedCount++;
        }
      }
      queryClient.invalidateQueries({ queryKey: ['job-issues', orgId] });
      queryClient.invalidateQueries({ queryKey: ['job-issues-count', orgId] });
      queryClient.invalidateQueries({ queryKey: ['job-issues-kpi-all', orgId] });
      queryClient.invalidateQueries({ queryKey: ['job-issues-kpi-issued', orgId] });
      queryClient.invalidateQueries({ queryKey: ['job-issues-kpi-draft', orgId] });
      queryClient.invalidateQueries({ queryKey: ['job-issues-kpi-rework', orgId] });
      queryClient.invalidateQueries({ queryKey: ['job-issues-kpi-cancelled', orgId] });

      if (failedCount === 0) {
        toast.success(successCount === 1 ? 'Challan deleted' : `${successCount} challans deleted`);
      } else if (successCount > 0) {
        toast.error(
          `Deleted ${successCount} draft(s). ${failedCount} challan(s) could not be deleted (only drafts can be deleted).`,
        );
      } else {
        toast.error('Could not delete selected challan(s). Only draft challans can be deleted.');
      }
      setSelectedIds([]);
      setIsBulkDeleteDialogOpen(false);
    } finally {
      setIsProcessing(false);
    }
  };

  // Quick summary counts for filter tabs
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

  const { data: reworkCount } = useQuery({
    queryKey: ['job-issues-kpi-rework', orgId],
    queryFn: () => fetchJobIssueCount(orgId!, { filter: 'rework' }),
    enabled: Boolean(orgId) && !stepId,
    staleTime: 30000,
  });

  const { data: cancelledCount } = useQuery({
    queryKey: ['job-issues-kpi-cancelled', orgId],
    queryFn: () => fetchJobIssueCount(orgId!, { filter: 'cancelled' }),
    enabled: Boolean(orgId) && !stepId,
    staleTime: 30000,
  });

  const quickFilterTabs = [
    { key: 'all', label: 'All Dispatches', count: totalAllCount },
    { key: 'issued', label: 'Issued & Active', count: issuedCount },
    { key: 'draft', label: 'Drafts', count: draftCount },
    { key: 'rework', label: 'Rework Issues', count: reworkCount },
    { key: 'cancelled', label: 'Cancelled', count: cancelledCount },
  ];

  const openDetail = (id: string) => {
    setSelectedIds([]);
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
            overflow: 'hidden',
            background: '#fff',
            transition: 'flex 0.15s ease',
          }}
        >
          {/* Header & Controls Toolbar */}
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
                padding: selectedId ? '12px 14px' : '14px 24px',
                background: '#fff',
                borderBottom: '1px solid #eef0f3',
                gap: 8,
                flexWrap: 'nowrap',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  minWidth: 0,
                  flex: 1,
                  overflow: 'hidden',
                }}
              >
                {!stepId ? (
                  <ListFilterDropdown
                    filters={filters}
                    value={filter}
                    onChange={handleFilterSelect}
                    fallbackLabel="All Challans"
                  />
                ) : (
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                    Challans for Step
                  </span>
                )}
                {isPageFetching && !isLoading && (
                  <span title="Updating...">
                    <RotateCw size={13} className="spin" color="#0284c7" />
                  </span>
                )}
              </div>

              {!stepId && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
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
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      navigate(`/organizations/${orgId}/jobwork/issues/new`, {
                        state: { returnUrl: location.pathname + location.search },
                      })
                    }
                    style={{
                      background: '#0284c7',
                      color: 'white',
                      border: 'none',
                      padding: selectedId ? '6px 12px' : '7px 16px',
                      borderRadius: 6,
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      whiteSpace: 'nowrap',
                      boxShadow: '0 2px 6px rgba(2, 132, 199, 0.25)',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#0369a1';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#0284c7';
                    }}
                  >
                    <Plus size={16} /> {selectedId ? 'New' : 'New Issue'}
                  </button>
                </div>
              )}
            </header>
          )}

          {/* Split View compact search bar */}
          {selectedId && !stepId && (
            <div
              style={{
                padding: '8px 12px',
                borderBottom: '1px solid #f1f5f9',
                background: '#fafbfc',
              }}
            >
              <div style={{ position: 'relative', width: '100%' }}>
                <Search
                  size={13}
                  style={{
                    position: 'absolute',
                    left: 9,
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
                  placeholder="Search in Challans..."
                  style={{
                    width: '100%',
                    height: 28,
                    padding: '0 26px 0 28px',
                    fontSize: 12,
                    borderRadius: 5,
                    border: '1px solid #e2e8f0',
                    background: '#fff',
                    outline: 'none',
                    color: '#1e293b',
                    boxSizing: 'border-box',
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
                      right: 6,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Full View Filter tabs and search bar */}
          {!selectedId && !stepId && (
            <div
              style={{
                padding: '12px 24px 0 24px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                background: '#fff',
                borderBottom: '1px solid #eef0f3',
              }}
            >
              {/* Quick Filter Tabs Bar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  overflowX: 'auto',
                }}
              >
                {quickFilterTabs.map((tab) => {
                  const isActive = filter === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => handleFilterSelect(tab.key)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '5px 12px',
                        borderRadius: 20,
                        fontSize: 12,
                        fontWeight: isActive ? 600 : 500,
                        background: isActive ? '#0284c7' : '#f1f5f9',
                        color: isActive ? '#ffffff' : '#475569',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span>{tab.label}</span>
                      {tab.count !== undefined && (
                        <span
                          style={{
                            padding: '1px 6px',
                            borderRadius: 10,
                            fontSize: 11,
                            fontWeight: 700,
                            background: isActive ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                            color: isActive ? '#ffffff' : '#334155',
                          }}
                        >
                          {tab.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Search Input Bar */}
              <div style={{ position: 'relative', width: '100%', marginBottom: 12 }}>
                <Search
                  size={14}
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
                    e.currentTarget.style.borderColor = '#0284c7';
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
            </div>
          )}

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
                  const sourceName = issue.sourceLocation?.name ?? 'Godown';
                  const targetName =
                    issue.processorNameSnapshot ??
                    (issue.processorType === 'internal' ? 'In-house' : 'Vendor');

                  return (
                    <button
                      key={issue.id}
                      type="button"
                      onClick={() => openDetail(issue.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        width: '100%',
                        textAlign: 'left',
                        padding: '12px 14px',
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
                      {/* Avatar Icon */}
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 8,
                          background: isSelected ? '#0284c7' : '#e0f2fe',
                          color: isSelected ? '#fff' : '#0284c7',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <Send size={15} />
                      </div>

                      {/* Card Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Row 1: Challan Number & Status Badge */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            marginBottom: 3,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color: isSelected ? '#0369a1' : '#0f172a',
                            }}
                          >
                            {issue.challanNumber}
                          </span>
                          <IssueStatusBadge status={issue.status} size="sm" />
                        </div>

                        {/* Row 2: Route (Origin -> Destination) */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            fontSize: 11.5,
                            color: '#475569',
                            marginBottom: 3,
                          }}
                        >
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: 100,
                            }}
                            title={sourceName}
                          >
                            {sourceName}
                          </span>
                          <ArrowRight size={10} color="#94a3b8" style={{ flexShrink: 0 }} />
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: 115,
                              fontWeight: 500,
                              color: issue.processorType === 'internal' ? '#0284c7' : '#7c3aed',
                            }}
                            title={targetName}
                          >
                            {targetName}
                          </span>
                        </div>

                        {/* Row 3: Job Order Reference & Qty / Date */}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: 11.5,
                            color: '#64748b',
                          }}
                        >
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: 115,
                              color: '#334155',
                              fontWeight: 500,
                            }}
                            title={issue.jobOrder?.jobOrderNumber ?? 'Direct Issue'}
                          >
                            {issue.jobOrder?.jobOrderNumber ?? 'Direct Issue'}
                          </span>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              flexShrink: 0,
                              marginLeft: 6,
                            }}
                          >
                            <span style={{ fontWeight: 600, color: '#0f172a' }}>
                              {formatQty(issue.totalQty)}
                            </span>
                            <span style={{ color: '#cbd5e1' }}>·</span>
                            <span style={{ fontSize: 11, color: '#94a3b8' }}>
                              {formatDate(issue.issueDate)}
                            </span>
                          </div>
                        </div>
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
                      <th
                        style={{
                          width: 44,
                          padding: '12px 16px',
                          textAlign: 'center',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={issues.length > 0 && selectedIds.length === issues.length}
                          onChange={toggleAll}
                          style={{ cursor: 'pointer', accentColor: '#0284c7' }}
                        />
                      </th>
                      {columns.map((col) => (
                        <th key={col.key} style={tableHeaderStyle} scope="col">
                          {col.label}
                        </th>
                      ))}
                      <th style={{ width: 44, textAlign: 'center', padding: '8px 12px' }}>
                        <button
                          type="button"
                          onClick={() => setIsColumnsOpen(true)}
                          title="Customize Columns"
                          aria-label="Customize Columns"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 28,
                            height: 28,
                            borderRadius: 4,
                            border: '1px solid #cbd5e1',
                            background: '#fff',
                            cursor: 'pointer',
                            color: '#475569',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#f0f7fd';
                            e.currentTarget.style.color = '#0284c7';
                            e.currentTarget.style.borderColor = '#0284c7';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#fff';
                            e.currentTarget.style.color = '#475569';
                            e.currentTarget.style.borderColor = '#cbd5e1';
                          }}
                        >
                          <SlidersHorizontal size={14} />
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {issues.map((issue, idx) => {
                      const isChecked = selectedIds.includes(issue.id);
                      return (
                        <tr
                          key={issue.id}
                          onClick={() => openDetail(issue.id)}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            cursor: 'pointer',
                            background: isChecked
                              ? '#f0f9ff'
                              : idx % 2 === 0
                                ? '#ffffff'
                                : '#fafafa',
                            transition: 'background 0.12s',
                          }}
                          onMouseEnter={(e) => {
                            if (!isChecked) e.currentTarget.style.background = '#f8fafc';
                          }}
                          onMouseLeave={(e) => {
                            if (!isChecked) {
                              e.currentTarget.style.background =
                                idx % 2 === 0 ? '#ffffff' : '#fafafa';
                            }
                          }}
                        >
                          <td
                            style={{
                              width: 44,
                              padding: '12px 16px',
                              textAlign: 'center',
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSelection(issue.id)}
                              style={{ cursor: 'pointer', accentColor: '#0284c7' }}
                            />
                          </td>
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
                          <td style={{ width: 44, textAlign: 'center', padding: '12px 16px' }} />
                        </tr>
                      );
                    })}
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

      <ConfirmDialog
        isOpen={isBulkDeleteDialogOpen}
        onCancel={() => setIsBulkDeleteDialogOpen(false)}
        onConfirm={handleBulkDelete}
        title="Delete Selected Material Issues"
        message={`Are you sure you want to delete ${selectedIds.length} selected challan(s)? Only draft challans can be deleted. Issued challans cannot be deleted.`}
        confirmText={isProcessing ? 'Deleting...' : 'Delete'}
        isConfirming={isProcessing}
      />
    </div>
  );
}
