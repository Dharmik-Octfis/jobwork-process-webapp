import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Folder, Star } from 'lucide-react';
import { format } from 'date-fns';
import {
  reportsApi,
  reportsCenterQueryKey,
  type ReportKey,
  type ReportListEntry,
} from './reports.api';

function formatLastVisited(iso: string | null): string {
  return iso ? format(new Date(iso), 'dd-MM-yyyy hh:mm a') : '—';
}

export function ReportsPage() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  // By default, nothing is selected
  const [activeCategory, setActiveCategory] = useState('');

  const queryKey = reportsCenterQueryKey(orgId ?? '');
  const {
    data: reports = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey,
    queryFn: () => reportsApi.listReports(orgId!),
    enabled: !!orgId,
  });

  // Optimistic: the star flips at once and rolls back if the save fails (the failure toast is global).
  const favoriteMutation = useMutation({
    mutationFn: ({ key, isFavorite }: { key: ReportKey; isFavorite: boolean }) =>
      reportsApi.setFavorite(orgId!, key, isFavorite),
    onMutate: async ({ key, isFavorite }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ReportListEntry[]>(queryKey);
      queryClient.setQueryData<ReportListEntry[]>(queryKey, (rows) =>
        rows?.map((r) => (r.key === key ? { ...r, isFavorite } : r)),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const toggleFavorite = (report: ReportListEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    favoriteMutation.mutate({ key: report.key, isFavorite: !report.isFavorite });
  };

  const categories = Array.from(new Set(reports.map((r) => r.category)));

  const filteredReports = activeCategory
    ? reports.filter((r) => r.category === activeCategory)
    : reports;

  const sortedReports = [...filteredReports].sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    return 0;
  });

  return (
    <div
      style={{
        background: '#f8fafc',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#fff',
          borderBottom: '1px solid #eef0f3',
          padding: '16px 24px',
        }}
      >
        <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#1e293b', margin: 0 }}>
          Reports Center
        </h1>
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Close"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: '#64748b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px',
            borderRadius: '50%',
            transition: 'background-color 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <X size={20} />
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar — on a phone the category <select> in the table header replaces it */}
        <div
          className="hidden-on-mobile"
          style={{
            width: '230px',
            background: '#fff',
            borderRight: '1px solid #eef0f3',
            display: 'flex',
            flexDirection: 'column',
            padding: '16px 12px',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: '#94a3b8',
              textTransform: 'uppercase',
              padding: '0 12px',
              marginBottom: '12px',
            }}
          >
            Report Category
          </div>

          {categories.map((cat) => {
            const isActive = activeCategory === cat;
            return (
              <button
                type="button"
                key={cat}
                aria-pressed={isActive}
                style={{
                  width: '100%',
                  border: 'none',
                  textAlign: 'left',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  background: isActive ? '#eff6ff' : 'transparent',
                  borderRadius: '6px',
                  color: isActive ? '#0062ff' : '#475569',
                  fontWeight: 500,
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  transition: 'background-color 0.15s',
                  marginBottom: '2px',
                }}
                onClick={() => setActiveCategory(cat === activeCategory ? '' : cat)}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = '#f8fafc';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <Folder size={16} color={isActive ? '#0062ff' : '#94a3b8'} strokeWidth={1.5} />
                {cat}
              </button>
            );
          })}
        </div>

        {/* Main Content */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            padding: '12px',
            overflowY: 'auto',
            background: '#f8fafc',
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '8px',
              border: '1px solid #eef0f3',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              overflow: 'hidden',
            }}
          >
            {/* Table Header Area */}
            <div
              style={{
                padding: '16px 24px',
                borderBottom: '1px solid #eef0f3',
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b', margin: 0 }}>
                {activeCategory || 'All Reports'}
              </h2>
              <span
                style={{
                  background: '#eff6ff',
                  color: '#0062ff',
                  fontSize: '12px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '12px',
                }}
              >
                {sortedReports.length}
              </span>
              <select
                className="visible-on-mobile"
                aria-label="Report category"
                value={activeCategory}
                onChange={(e) => setActiveCategory(e.target.value)}
                style={{
                  marginLeft: 'auto',
                  minHeight: '44px',
                  maxWidth: '100%',
                  padding: '0 12px',
                  fontSize: '14px',
                  color: '#334155',
                  background: '#fff',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                }}
              >
                <option value="">All categories</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* Table — scrolls sideways on a phone instead of squashing */}
            <div className="responsive-table-wrapper">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #eef0f3' }}>
                    <th
                      style={{
                        padding: '12px 24px',
                        textAlign: 'left',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        width: '40%',
                      }}
                    >
                      Report Name
                    </th>
                    <th
                      style={{
                        padding: '12px 24px',
                        textAlign: 'left',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        width: '30%',
                      }}
                    >
                      Created By
                    </th>
                    <th
                      style={{
                        padding: '12px 24px',
                        textAlign: 'left',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        width: '30%',
                      }}
                    >
                      Last Visited
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td
                        colSpan={3}
                        style={{
                          padding: '24px',
                          textAlign: 'center',
                          color: '#64748b',
                          fontSize: '13px',
                        }}
                      >
                        Loading reports…
                      </td>
                    </tr>
                  ) : isError ? (
                    <tr>
                      <td
                        colSpan={3}
                        style={{
                          padding: '24px',
                          textAlign: 'center',
                          color: '#64748b',
                          fontSize: '13px',
                        }}
                      >
                        Could not load reports.
                      </td>
                    </tr>
                  ) : sortedReports.length > 0 ? (
                    sortedReports.map((report) => {
                      const isFav = report.isFavorite;
                      const reportUrl = `/organizations/${orgId}/reports/${report.path}`;
                      return (
                        // The whole row is a mouse/touch convenience; the name <Link> is the keyboard path.
                        <tr
                          key={report.key}
                          style={{
                            borderBottom: '1px solid #eef0f3',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor = 'transparent')
                          }
                          onClick={() => navigate(reportUrl)}
                        >
                          <td style={{ padding: '14px 24px', fontSize: '13px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <button
                                type="button"
                                onClick={(e) => toggleFavorite(report, e)}
                                aria-pressed={isFav}
                                aria-label={
                                  isFav
                                    ? `Remove ${report.name} from favorites`
                                    : `Add ${report.name} to favorites`
                                }
                                title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                                // 14px padding cancelled by -14px margin: a 44px touch target around a 16px icon, layout unchanged.
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  padding: '14px',
                                  margin: '-14px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                }}
                              >
                                <Star
                                  size={16}
                                  color={isFav ? '#f59e0b' : '#cbd5e1'}
                                  fill={isFav ? '#f59e0b' : 'none'}
                                  strokeWidth={1.5}
                                  style={{ transition: 'all 0.2s' }}
                                />
                              </button>
                              <Link
                                to={reportUrl}
                                // The row's own click would navigate a second time.
                                onClick={(e) => e.stopPropagation()}
                                style={{ color: '#0062ff', fontWeight: 500 }}
                              >
                                {report.name}
                              </Link>
                            </div>
                          </td>
                          <td
                            style={{
                              padding: '14px 24px',
                              fontSize: '13px',
                              color: '#334155',
                              fontWeight: 400,
                            }}
                          >
                            System Generated
                          </td>
                          <td
                            style={{
                              padding: '14px 24px',
                              fontSize: '13px',
                              color: '#334155',
                              fontWeight: 400,
                            }}
                          >
                            {formatLastVisited(report.lastVisitedAt)}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        colSpan={3}
                        style={{
                          padding: '24px',
                          textAlign: 'center',
                          color: '#64748b',
                          fontSize: '13px',
                        }}
                      >
                        No reports found for this category.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
