import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Route as RouteIcon, SlidersHorizontal, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { CustomizeColumnsModal } from '../../../components/ui/CustomizeColumnsModal';
import { ListFilterDropdown } from '../../../components/ui/ListFilterDropdown';
import { Pagination } from '../../../components/ui/Pagination';
import { useListColumns } from '../../../hooks/useListColumns';
import { useListCount } from '../../../hooks/useListCount';
import { useListSearch } from '../../../hooks/useListSearch';
import { formatDate } from '../../../lib/formatDate';
import { deleteRoute, fetchRouteCount, fetchRoutes } from './processRoutes.api';
import { RouteDetail } from './RouteDetail';
import { stepSummary, type Route } from './processRoutes.schemas';

/**
 * How each selectable column renders. Keys match the backend catalog
 * (listViews.catalog.ts).
 *
 * No `cf:` branch here — `process_route` is list-only now
 * (LIST_ONLY_ENTITY_TYPES), so the server never merges a custom-field column
 * into this catalog.
 */
function renderRouteCell(route: Route, key: string): string {
  switch (key) {
    case 'stepCount':
      return String(route.steps.length);
    case 'stepSummary':
      return stepSummary(route);
    case 'createdAt':
    case 'updatedAt':
      return formatDate(route[key]);
    default: {
      const value = (route as unknown as Record<string, unknown>)[key];
      if (value === null || value === undefined || value === '') return '-';
      return String(value);
    }
  }
}

const headerStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontWeight: 600,
  fontSize: 11,
  color: '#64748b',
  textTransform: 'uppercase',
};

export function RoutesList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');

  const { search, filter, setFilter, perPage, setPerPage, page, setPage } = useListSearch('all');

  const { data, isLoading } = useQuery({
    queryKey: ['routes', orgId, search, filter, page, perPage],
    queryFn: () => fetchRoutes(orgId!, { search: search || undefined, filter, page, perPage }),
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
  });

  const routes = data?.results ?? [];
  const pageContext = data?.pageContext;

  const {
    total,
    isCounting,
    request: requestCount,
  } = useListCount(['routes-count', orgId, search, filter], () =>
    fetchRouteCount(orgId!, { search: search || undefined, filter }),
  );

  const {
    catalog,
    visible,
    filters,
    columns,
    save: saveColumns,
  } = useListColumns(orgId, 'process_route');
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);

  const queryClient = useQueryClient();
  const [toDelete, setToDelete] = useState<Route | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRoute(orgId!, id),
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: ['routes', orgId] });
      setToDelete(null);
      if (selectedId === id) setSearchParams({});
    },
  });

  const openDetail = (id: string) => setSearchParams({ id });
  const newPath = `/organizations/${orgId}/settings/jobwork/routes/new`;

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
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#f8fafc' }}>
        <div
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
              background: '#fff',
              borderBottom: '1px solid #eef0f3',
            }}
          >
            <ListFilterDropdown
              filters={filters}
              value={filter}
              onChange={setFilter}
              fallbackLabel="All Routes"
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
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
              )}
              <button
                type="button"
                onClick={() => navigate(newPath)}
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
                  whiteSpace: 'nowrap',
                }}
              >
                <Plus size={16} /> New
              </button>
            </div>
          </header>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
                Loading routes…
              </div>
            ) : routes.length === 0 && search ? (
              <div style={{ padding: '48px 32px', textAlign: 'center', color: '#64748b' }}>
                No routes match &ldquo;{search}&rdquo;.
              </div>
            ) : routes.length === 0 ? (
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
                  <RouteIcon size={40} color="#94a3b8" />
                </div>
                <h2
                  style={{ fontSize: 20, fontWeight: 600, color: '#1e293b', margin: '0 0 8px 0' }}
                >
                  No Routes Yet
                </h2>
                <p
                  style={{ color: '#64748b', maxWidth: 440, margin: '0 0 24px 0', lineHeight: 1.5 }}
                >
                  A route is a sequence you run often — grey → dyeing → printing → finishing. Build
                  one and every job order that uses it starts pre-filled. A job order can also be
                  built step by step without one.
                </p>
                <button
                  type="button"
                  onClick={() => navigate(newPath)}
                  style={{
                    background: '#28a745',
                    color: 'white',
                    border: 'none',
                    padding: '10px 24px',
                    borderRadius: 4,
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  Create Route
                </button>
              </div>
            ) : selectedId ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div
                  style={{
                    padding: '8px 16px',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#64748b',
                    background: '#f9f9fb',
                    borderBottom: '1px solid #eef0f3',
                  }}
                >
                  Routes
                </div>
                {routes.map((route) => (
                  <button
                    key={route.id}
                    type="button"
                    onClick={() => openDetail(route.id)}
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
                      background: selectedId === route.id ? '#f1f5f9' : 'transparent',
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
                      {route.name}
                    </span>
                    <span style={{ fontSize: 12, color: '#64748b' }}>{stepSummary(route)}</span>
                  </button>
                ))}
              </div>
            ) : (
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
                    <th style={{ ...headerStyle, width: 60 }} scope="col" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {routes.map((route) => (
                    /**
                     * The whole row opens the route. The name stays a real
                     * `<button>` underneath it — a clickable `<tr>` is invisible to
                     * Tab, so without it the list would be unreachable by keyboard
                     * (CLAUDE.md). The row click is the mouse convenience; the
                     * button is the control.
                     */
                    <tr
                      key={route.id}
                      onClick={() => openDetail(route.id)}
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
                              onClick={() => openDetail(route.id)}
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
                              {renderRouteCell(route, col.key)}
                            </button>
                          ) : (
                            renderRouteCell(route, col.key)
                          )}
                        </td>
                      ))}
                      <td style={{ padding: '12px 16px' }}>
                        <button
                          type="button"
                          // Deleting must not also open the row underneath it.
                          onClick={(e) => {
                            e.stopPropagation();
                            setToDelete(route);
                          }}
                          title={`Delete ${route.name}`}
                          aria-label={`Delete ${route.name}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 28,
                            height: 28,
                            border: '1px solid #e2e8f0',
                            borderRadius: 4,
                            background: '#fff',
                            cursor: 'pointer',
                            color: '#94a3b8',
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

        {selectedId && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <RouteDetail routeId={selectedId} onClose={() => setSearchParams({})} />
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
        isOpen={Boolean(toDelete)}
        title="Delete Route"
        message={
          toDelete
            ? `Delete "${toDelete.name}"? Job orders already created from it keep their own copy of the steps and are unaffected.`
            : ''
        }
        confirmText={deleteMutation.isPending ? 'Deleting…' : 'Delete'}
        onConfirm={() => {
          if (toDelete) deleteMutation.mutate(toDelete.id);
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
