import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, SlidersHorizontal, Trash2, Workflow } from 'lucide-react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { CustomizeColumnsModal } from '../../../components/ui/CustomizeColumnsModal';
import { ListFilterDropdown } from '../../../components/ui/ListFilterDropdown';
import { Pagination } from '../../../components/ui/Pagination';
import { useListColumns } from '../../../hooks/useListColumns';
import { useListCount } from '../../../hooks/useListCount';
import { useListSearch } from '../../../hooks/useListSearch';
import { CUSTOM_FIELD_PREFIX } from '../../list-views/listViews.api';
import { deleteProcess, fetchProcessCount, fetchProcesses } from './processes.api';
import { ProcessDetail } from './ProcessDetail';
import { rateBasisLabel, type Process } from './processes.schemas';

/**
 * How each selectable column renders. Keys match the backend catalog
 * (listViews.catalog.ts); anything prefixed `cf:` is a per-org custom field read
 * out of the row's `customFields` blob, so a new custom field needs no code here.
 *
 * The booleans render as the CONSEQUENCE, not as "Yes"/"No" — a column headed
 * "Preserves Packaging" full of Yes tells a reader nothing they can act on.
 */
function renderProcessCell(process: Process, key: string): string {
  if (key.startsWith(CUSTOM_FIELD_PREFIX)) {
    const value = process.customFields?.[key.slice(CUSTOM_FIELD_PREFIX.length)];
    if (value === null || value === undefined || value === '') return '-';
    return Array.isArray(value) ? value.join(', ') : String(value);
  }

  switch (key) {
    case 'rateBasis':
      return rateBasisLabel(process.rateBasis);
    case 'itemChanges':
      return process.itemChanges ? 'New item' : 'Same item';
    case 'isActive':
      return process.isActive ? 'Active' : 'Inactive';
    case 'defaultTolerancePct':
      return process.defaultTolerancePct === null ? '-' : `${process.defaultTolerancePct}%`;
    case 'defaultIssueUom':
      return process.defaultIssueUom?.unitName ?? '-';
    case 'defaultReceiveUom':
      return process.defaultReceiveUom?.unitName ?? '-';
    case 'createdAt':
    case 'updatedAt':
      return new Date(process[key]).toLocaleDateString();
    default: {
      const value = (process as unknown as Record<string, unknown>)[key];
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

export function ProcessesList() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');

  // Search term (from the global top-bar box, via `?search=`), preset view and
  // page cursor, all from the shared hook so every list wires this the same way.
  const { search, filter, setFilter, perPage, setPerPage, page, setPage } = useListSearch('all');

  const { data, isLoading } = useQuery({
    // orgId in the key, or switching org serves the previous tenant's cache.
    queryKey: ['processes', orgId, search, filter, page, perPage],
    queryFn: () => fetchProcesses(orgId!, { search: search || undefined, filter, page, perPage }),
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
  });

  const processes = data?.results ?? [];
  const pageContext = data?.pageContext;

  const {
    total,
    isCounting,
    request: requestCount,
  } = useListCount(['processes-count', orgId, search, filter], () =>
    fetchProcessCount(orgId!, { search: search || undefined, filter }),
  );

  const {
    catalog,
    visible,
    filters,
    columns,
    save: saveColumns,
  } = useListColumns(orgId, 'process');
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);

  const queryClient = useQueryClient();
  const [toDelete, setToDelete] = useState<Process | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProcess(orgId!, id),
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: ['processes', orgId] });
      setToDelete(null);
      // The detail pane was showing the row that just went away.
      if (selectedId === id) setSearchParams({});
    },
  });

  const openDetail = (id: string) => setSearchParams({ id });

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
              fallbackLabel="Active Processes"
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
                onClick={() => navigate(`/organizations/${orgId}/jobwork/processes/new`)}
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
                Loading processes…
              </div>
            ) : processes.length === 0 && search ? (
              <div style={{ padding: '48px 32px', textAlign: 'center', color: '#64748b' }}>
                No processes match &ldquo;{search}&rdquo;.
              </div>
            ) : processes.length === 0 ? (
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
                  <Workflow size={40} color="#94a3b8" />
                </div>
                <h2
                  style={{ fontSize: 20, fontWeight: 600, color: '#1e293b', margin: '0 0 8px 0' }}
                >
                  No Processes Yet
                </h2>
                <p
                  style={{ color: '#64748b', maxWidth: 420, margin: '0 0 24px 0', lineHeight: 1.5 }}
                >
                  A process is an operation someone performs on your material — dyeing, printing,
                  cutting, stitching. Add the ones you run, then build routes from them.
                </p>
                <button
                  type="button"
                  onClick={() => navigate(`/organizations/${orgId}/jobwork/processes/new`)}
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
                  Create Process
                </button>
              </div>
            ) : selectedId ? (
              /* Narrow master pane beside the detail. Each row is a real button,
                 so Tab walks the list and Enter opens a row. */
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
                  Processes
                </div>
                {processes.map((process) => (
                  <button
                    key={process.id}
                    type="button"
                    onClick={() => openDetail(process.id)}
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
                      background: selectedId === process.id ? '#f1f5f9' : 'transparent',
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
                      {process.name}
                    </span>
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      {process.code || rateBasisLabel(process.rateBasis)}
                    </span>
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
                    {/* No visible label — the column is icon buttons, each of
                        which carries its own aria-label naming the row. */}
                    <th style={{ ...headerStyle, width: 60 }} scope="col" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {processes.map((process) => (
                    /**
                     * The whole row opens the process. The LOCKED column stays a
                     * real `<button>` underneath it: a row `onClick` is invisible
                     * to Tab, so it is the mouse convenience and the button is the
                     * control (CLAUDE.md).
                     */
                    <tr
                      key={process.id}
                      onClick={() => openDetail(process.id)}
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
                              onClick={() => openDetail(process.id)}
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
                              {renderProcessCell(process, col.key)}
                            </button>
                          ) : (
                            renderProcessCell(process, col.key)
                          )}
                        </td>
                      ))}
                      <td style={{ padding: '12px 16px' }}>
                        <button
                          type="button"
                          // Deleting must not also open the row underneath it.
                          onClick={(e) => {
                            e.stopPropagation();
                            setToDelete(process);
                          }}
                          title={`Delete ${process.name}`}
                          aria-label={`Delete ${process.name}`}
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
            <ProcessDetail processId={selectedId} onClose={() => setSearchParams({})} />
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
        title="Delete Process"
        message={
          toDelete
            ? `Delete "${toDelete.name}"? Routes and job orders that already reference it keep their history.`
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
