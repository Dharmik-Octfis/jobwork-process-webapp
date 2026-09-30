import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import {
  ClipboardList,
  Plus,
  SlidersHorizontal,
  Search,
  X,
  RotateCw,
  Layers,
  Clock,
  CheckCircle2,
  Building2,
  User,
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

function getOrderInitials(num?: string): string {
  if (!num) return 'JO';
  const clean = num.replace(/[^a-zA-Z0-9]/g, '');
  return clean.slice(0, 2).toUpperCase() || 'JO';
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
      return <JobOrderStatusBadge status={order.status} />;
    case 'inputItem':
      return (
        <span style={{ fontWeight: 500, color: '#1e293b' }}>{order.inputItem?.name ?? '-'}</span>
      );
    case 'inputQty':
      return (
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {formatQty(order.inputQty)}
          {order.inputUom ? ` ${order.inputUom.symbol ?? order.inputUom.unitName}` : ''}
        </span>
      );
    case 'stepCount': {
      const totalSteps = order.steps?.length ?? 0;
      const completedSteps = (order.steps || []).filter(
        (s) => (s as { status?: string }).status === 'completed',
      ).length;
      const pct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 100 }}>
          <div
            style={{
              width: 50,
              height: 5,
              borderRadius: 3,
              background: '#e2e8f0',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: pct === 100 ? '#10b981' : '#0284c7',
                borderRadius: 3,
              }}
            />
          </div>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {completedSteps}/{totalSteps}
          </span>
        </div>
      );
    }
    case 'ownership':
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 600,
            background: order.ownership === 'customer' ? '#f5f3ff' : '#f0f9ff',
            color: order.ownership === 'customer' ? '#7c3aed' : '#0284c7',
            border: `1px solid ${order.ownership === 'customer' ? '#ddd6fe' : '#bae6fd'}`,
          }}
        >
          {order.ownership === 'customer' ? (
            <>
              <User size={11} /> Customer
            </>
          ) : (
            <>
              <Building2 size={11} /> Internal
            </>
          )}
        </span>
      );
    case 'orderDate':
    case 'targetDate':
    case 'createdAt':
    case 'updatedAt':
      return <span style={{ color: '#475569', fontSize: 12 }}>{formatDate(order[key])}</span>;
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

  const { search, setSearch, filter, setFilter, perPage, setPerPage, page, setPage } =
    useListSearch('all');

  const [searchInput, setSearchInput] = useState(search || '');
  const [prevSearch, setPrevSearch] = useState(search);
  const [isRefreshing, setIsRefreshing] = useState(false);

  if (prevSearch !== search) {
    setPrevSearch(search);
    setSearchInput(search || '');
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  const handleSearchClear = () => {
    setSearchInput('');
    setSearch('');
  };

  const { data, isLoading } = useQuery({
    queryKey: ['job-orders', orgId, search, filter, page, perPage],
    queryFn: () => fetchJobOrders(orgId!, { search: search || undefined, filter, page, perPage }),
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
  });

  const results = data?.results;
  const orders = useMemo(() => results ?? [], [results]);
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
      toast.success('Job order deleted');
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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['job-orders', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['job-orders-count', orgId] }),
    ]);
    setTimeout(() => {
      setIsRefreshing(false);
      toast.success('Job orders refreshed');
    }, 400);
  };

  // KPI Metrics calculated dynamically
  const stats = useMemo(() => {
    let drafts = 0;
    let inProgress = 0;
    let completed = 0;
    let totalQty = 0;

    for (const order of orders) {
      const st = (order.status || '').toLowerCase();
      if (st === 'draft') drafts++;
      else if (st === 'in_progress' || st === 'open' || st === 'pending') inProgress++;
      else if (st === 'completed' || st === 'closed') completed++;

      totalQty += Number(order.inputQty || 0);
    }

    return {
      totalCount: total ?? orders.length,
      totalQty,
      drafts,
      inProgress,
      completed,
    };
  }, [orders, total]);

  const quickFilterTabs = [
    { key: 'all', label: 'All Orders', count: stats.totalCount },
    { key: 'draft', label: 'Draft', count: stats.drafts },
    { key: 'in_progress', label: 'In Progress', count: stats.inProgress },
    { key: 'completed', label: 'Completed', count: stats.completed },
  ];

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
            flex: selectedId ? '0 0 340px' : 1,
            borderRight: selectedId ? '1px solid #e2e8f0' : 'none',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: '#fff',
          }}
        >
          {/* Executive KPI Metrics Ribbon (Displayed in Full View) */}
          {!selectedId && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 12,
                padding: '16px 24px 0 24px',
                background: '#fff',
              }}
            >
              {/* Card 1: Total Job Orders */}
              <div
                onClick={() => setFilter('all')}
                style={{
                  background: filter === 'all' ? '#f0f9ff' : '#fff',
                  border: `1px solid ${filter === 'all' ? '#0284c7' : '#e2e8f0'}`,
                  borderRadius: 10,
                  padding: '14px 16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  transition: 'all 0.15s ease',
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: '#e0f2fe',
                    color: '#0284c7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <ClipboardList size={20} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Total Job Orders
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginTop: 1 }}>
                    {stats.totalCount}
                  </div>
                  <div style={{ fontSize: 11, color: '#0284c7', fontWeight: 500 }}>
                    {formatQty(stats.totalQty)} total input units
                  </div>
                </div>
              </div>

              {/* Card 2: Drafts / Planning */}
              <div
                onClick={() => setFilter('draft')}
                style={{
                  background: filter === 'draft' ? '#f8fafc' : '#fff',
                  border: `1px solid ${filter === 'draft' ? '#64748b' : '#e2e8f0'}`,
                  borderRadius: 10,
                  padding: '14px 16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  transition: 'all 0.15s ease',
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: '#f1f5f9',
                    color: '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Clock size={20} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Draft Orders
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginTop: 1 }}>
                    {stats.drafts}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Awaiting production release</div>
                </div>
              </div>

              {/* Card 3: In Progress / Active Runs */}
              <div
                onClick={() => setFilter('in_progress')}
                style={{
                  background: filter === 'in_progress' ? '#f0f9ff' : '#fff',
                  border: `1px solid ${filter === 'in_progress' ? '#0284c7' : '#e2e8f0'}`,
                  borderRadius: 10,
                  padding: '14px 16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  transition: 'all 0.15s ease',
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: '#e0f2fe',
                    color: '#0284c7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Layers size={20} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    In Progress
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#0284c7', marginTop: 1 }}>
                    {stats.inProgress}
                  </div>
                  <div style={{ fontSize: 11, color: '#0284c7' }}>Active in manufacturing</div>
                </div>
              </div>

              {/* Card 4: Completed Runs */}
              <div
                onClick={() => setFilter('completed')}
                style={{
                  background: filter === 'completed' ? '#f0fdf4' : '#fff',
                  border: `1px solid ${filter === 'completed' ? '#10b981' : '#e2e8f0'}`,
                  borderRadius: 10,
                  padding: '14px 16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  transition: 'all 0.15s ease',
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: '#dcfce7',
                    color: '#15803d',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <CheckCircle2 size={20} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Completed
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#16a34a', marginTop: 1 }}>
                    {stats.completed}
                  </div>
                  <div style={{ fontSize: 11, color: '#16a34a' }}>Finished successfully</div>
                </div>
              </div>
            </div>
          )}

          {/* Quick-Status Filter Tabs */}
          {!selectedId && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                padding: '14px 24px 8px 24px',
                borderBottom: '1px solid #f1f5f9',
                background: '#fff',
                overflowX: 'auto',
              }}
            >
              {quickFilterTabs.map((tab) => {
                const isActive = (filter || 'all').toLowerCase() === tab.key.toLowerCase();
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setFilter(tab.key)}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: isActive ? 600 : 500,
                      color: isActive ? '#0284c7' : '#64748b',
                      background: isActive ? '#e0f2fe' : '#f8fafc',
                      border: `1px solid ${isActive ? '#bae6fd' : '#e2e8f0'}`,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      whiteSpace: 'nowrap',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>{tab.label}</span>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '1px 6px',
                        borderRadius: 10,
                        background: isActive ? '#0284c7' : '#e2e8f0',
                        color: isActive ? '#fff' : '#64748b',
                        fontWeight: 600,
                      }}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Action Header / Toolbar */}
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
                padding: selectedId ? '12px 16px' : '14px 24px',
                background: '#fff',
                borderBottom: '1px solid #e2e8f0',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                <ListFilterDropdown
                  filters={filters}
                  value={filter}
                  onChange={setFilter}
                  fallbackLabel="Open Job Orders"
                />

                {/* Inline Search Bar */}
                {!selectedId && (
                  <form
                    onSubmit={handleSearchSubmit}
                    style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      maxWidth: 280,
                      width: '100%',
                    }}
                  >
                    <Search
                      size={15}
                      style={{
                        position: 'absolute',
                        left: 10,
                        color: '#94a3b8',
                        pointerEvents: 'none',
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Search orders, items..."
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 28px 6px 32px',
                        fontSize: 13,
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                        background: '#f8fafc',
                        outline: 'none',
                        color: '#0f172a',
                        transition: 'all 0.15s ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.background = '#fff';
                        e.currentTarget.style.borderColor = '#0284c7';
                        e.currentTarget.style.boxShadow = '0 0 0 2px rgba(2, 132, 199, 0.12)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.background = '#f8fafc';
                        e.currentTarget.style.borderColor = '#cbd5e1';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                    {searchInput && (
                      <button
                        type="button"
                        onClick={handleSearchClear}
                        style={{
                          position: 'absolute',
                          right: 8,
                          background: 'none',
                          border: 'none',
                          color: '#94a3b8',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          padding: 2,
                        }}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </form>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {/* Refresh Trigger */}
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  title="Refresh job orders"
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
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#fff';
                    e.currentTarget.style.color = '#64748b';
                  }}
                >
                  <RotateCw
                    size={15}
                    style={{
                      animation: isRefreshing ? 'spin 0.8s linear infinite' : 'none',
                    }}
                  />
                </button>

                {/* Column Customizer */}
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
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#fff';
                      e.currentTarget.style.color = '#64748b';
                    }}
                  >
                    <SlidersHorizontal size={15} />
                  </button>
                )}

                {/* Primary Action Button */}
                <button
                  type="button"
                  onClick={() =>
                    navigate(newPath, { state: { returnUrl: location.pathname + location.search } })
                  }
                  style={{
                    background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                    color: 'white',
                    border: 'none',
                    padding: '7px 16px',
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
                  <Plus size={16} /> New Job Order
                </button>
              </div>
            </header>
          )}

          {/* List / Table Content */}
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
                  style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px 0' }}
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
                >
                  Create Job Order
                </button>
              </div>
            ) : selectedId ? (
              /* Master list when split view is open */
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {orders.map((order) => {
                  const isSelected = selectedId === order.id;
                  const initials = getOrderInitials(order.jobOrderNumber);
                  return (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => openOrder(order.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
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
                          width: 34,
                          height: 34,
                          borderRadius: 8,
                          background: isSelected ? '#0284c7' : '#e0f2fe',
                          color: isSelected ? '#fff' : '#0284c7',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 12,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {initials}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
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
                              fontWeight: 700,
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
                            fontSize: 12,
                            color: '#64748b',
                          }}
                        >
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {order.inputItem?.name ?? '-'} · {formatQty(order.inputQty)}
                          </span>
                          {order.orderDate && (
                            <span
                              style={{
                                fontSize: 11,
                                color: '#94a3b8',
                                flexShrink: 0,
                                marginLeft: 6,
                              }}
                            >
                              {formatDate(order.orderDate)}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              /* Full Enterprise Table View */
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
                      <th style={{ ...headerStyle, width: 60 }}>#</th>
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
                      const initials = getOrderInitials(order.jobOrderNumber);
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
                          <td style={{ width: 60, padding: '12px 16px' }}>
                            <div
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 8,
                                background: '#e0f2fe',
                                color: '#0284c7',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 11,
                                fontWeight: 700,
                              }}
                            >
                              {initials}
                            </div>
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
                                    fontWeight: 700,
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

        {/* Detail Panel */}
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
