import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { toApiErrorMessage } from '../../api/client';
import { useListSearch } from '../../hooks/useListSearch';
import { useListCount } from '../../hooks/useListCount';
import { useListColumns } from '../../hooks/useListColumns';
import { Pagination } from '../../components/ui/Pagination';
import { CustomizeColumnsModal } from '../../components/ui/CustomizeColumnsModal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { permissionTemplatesApi, type PermissionTemplate } from './permissionTemplates.api';
import { PermissionTemplateDetail } from './PermissionTemplateDetail';

/**
 * Settings → **Permissions**. A permission template — "profile" in the UI, because
 * that is what an admin calls the thing they put a person on — is a named bundle of
 * permissions and the ONLY thing that decides what a member may do.
 *
 * Built from the same pieces as every other module list — `useListSearch`,
 * `useListColumns`, `CustomizeColumnsModal`, `Pagination`, and a `?id=` detail
 * pane — so it behaves identically to Users and Vendors.
 *
 * The one piece it does NOT have is the preset-view picker every other list
 * carries. This screen shows every profile, always: the splits it used to offer
 * ("Custom" / "Built-in") were removed on 2026-08-03, so the heading is static
 * text rather than a `ListFilterDropdown` and no `?filter=` is sent. A stale
 * bookmarked `?filter=built_in` is therefore ignored rather than 400ing.
 *
 * 🔴 A profile is NOT a job title. Titles live in Settings → Roles and are assigned
 * independently: the same title can hold different access, and one profile can span
 * titles. Nothing on the server reads a role. The pointer to Roles lives in the
 * empty state and the detail pane rather than a banner over the table, so this
 * screen keeps the chrome every other list has.
 */

/** "Priya Shah · 20/07/2026, 14:32" — who and when, read together or not at all. */
function formatActor(name: string, iso: string): string {
  const at = new Date(iso);
  return `${name} · ${at.toLocaleDateString()}, ${at.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/**
 * How each selectable column renders. Keys match the backend catalog
 * (listViews.catalog.ts). There is no `cf:` branch here: permission templates are
 * not a domain table and carry no custom fields — see LIST_ONLY_ENTITY_TYPES.
 */
function renderTemplateCell(template: PermissionTemplate, key: string): string {
  switch (key) {
    case 'name':
      return template.name;
    case 'description':
      return template.description || '-';
    case 'createdBy':
      return formatActor(template.createdByName, template.createdAt);
    case 'updatedBy':
      return formatActor(template.updatedByName, template.updatedAt);
    case 'memberCount':
      return String(template.memberCount);
    case 'permissionCount':
      // The Owner profile stores no keys — it resolves to the whole catalog at
      // runtime, so a number here would be a snapshot that silently goes stale.
      return template.grantsAllPermissions ? 'All' : String(template.permissions.length);
    case 'type':
      return template.isSystem ? 'Built-in' : 'Custom';
    default:
      return '-';
  }
}

export function PermissionTemplatesPage() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');

  const { search, perPage, setPerPage, page, setPage } = useListSearch();

  const { data, isLoading } = useQuery({
    // orgId in the key or an org switch serves the previous tenant's cache;
    // search + page so each combination is cached separately.
    queryKey: ['permission-templates', orgId, search, page, perPage],
    queryFn: () =>
      permissionTemplatesApi.list(orgId!, { search: search || undefined, page, perPage }),
    enabled: Boolean(orgId),
    // Keep the current page visible while the next one loads.
    placeholderData: (prev) => prev,
  });

  const templates = data?.results ?? [];
  const pageContext = data?.pageContext;

  const {
    total,
    isCounting,
    request: requestCount,
  } = useListCount(['permission-templates-count', orgId, search], () =>
    permissionTemplatesApi.count(orgId!, { search: search || undefined }),
  );

  // Column layout ("Customize Columns") — per user, per org, per module.
  const {
    catalog,
    visible,
    columns,
    save: saveColumns,
  } = useListColumns(orgId, 'permission_template');
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);

  const queryClient = useQueryClient();
  const [toDelete, setToDelete] = useState<PermissionTemplate | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => permissionTemplatesApi.remove(orgId!, id),
    onSuccess: async (_result, id) => {
      setServerError(null);
      setToDelete(null);
      // Clear the detail pane if it was showing the row that just went away.
      if (selectedId === id) setSearchParams({});
      await queryClient.invalidateQueries({ queryKey: ['permission-templates', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['permission-templates-all', orgId] });
    },
    onError: (err) => setServerError(toApiErrorMessage(err)),
  });

  if (!orgId) return null;

  const headerStyle = {
    padding: '12px 16px',
    fontWeight: 600,
    fontSize: 11,
    color: '#64748b',
    textTransform: 'uppercase' as const,
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
            <h1
              style={{
                fontSize: '18px',
                fontWeight: 600,
                color: '#000',
                margin: 0,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              Profiles
            </h1>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {!selectedId && (
                <button
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
              {/* A full-page route, not a modal: the editor is a hundred checkboxes
                  wide and needs a URL of its own so an interrupted edit is
                  reachable again. */}
              <button
                onClick={() => navigate(`/organizations/${orgId}/settings/permissions/new`)}
                style={{
                  background: '#186337',
                  color: 'white',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontWeight: 500,
                  fontSize: '13px',
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

          {serverError && (
            <div
              style={{
                padding: '10px 24px',
                background: 'var(--danger-50)',
                color: 'var(--color-danger)',
                borderBottom: '1px solid #eef0f3',
                fontSize: 13,
              }}
            >
              {serverError}
            </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isLoading && templates.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                Loading profiles...
              </div>
            ) : templates.length === 0 && search ? (
              <div style={{ padding: '48px 32px', textAlign: 'center', color: '#64748b' }}>
                No profiles match &ldquo;{search}&rdquo;.
              </div>
            ) : templates.length === 0 ? (
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
                    marginBottom: '16px',
                  }}
                >
                  <ShieldCheck size={40} color="#94a3b8" />
                </div>
                <h2
                  style={{ fontSize: 20, fontWeight: 600, color: '#1e293b', margin: '0 0 8px 0' }}
                >
                  No Profiles Here
                </h2>
                <p
                  style={{ color: '#64748b', maxWidth: 420, margin: '0 0 24px 0', lineHeight: 1.5 }}
                >
                  A profile is a set of permissions. Members are put on a profile — permissions are
                  never granted to one person directly. Job titles are separate and live in{' '}
                  <Link
                    to={`/organizations/${orgId}/settings/roles`}
                    style={{ color: '#0062ff', fontWeight: 500 }}
                  >
                    Settings → Roles
                  </Link>
                  .
                </p>
                <button
                  onClick={() => navigate(`/organizations/${orgId}/settings/permissions/new`)}
                  style={{
                    background: '#28a745',
                    color: 'white',
                    border: 'none',
                    padding: '10px 24px',
                    borderRadius: '4px',
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  Create Profile
                </button>
              </div>
            ) : selectedId ? (
              // Narrow master pane beside the detail panel.
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {templates.map((template) => (
                  <div
                    key={template.id}
                    onClick={() => setSearchParams({ id: template.id })}
                    style={{
                      padding: '12px 16px',
                      borderBottom: '1px solid #eef0f3',
                      cursor: 'pointer',
                      background: selectedId === template.id ? '#f1f5f9' : 'transparent',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 500,
                        color: '#1e293b',
                        marginBottom: '4px',
                      }}
                    >
                      {template.name}
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>
                      {template.memberCount} member{template.memberCount === 1 ? '' : 's'}
                    </div>
                  </div>
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
                      <th key={col.key} style={headerStyle}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {templates.map((template) => (
                    <tr
                      key={template.id}
                      onClick={() => setSearchParams({ id: template.id })}
                      style={{
                        borderBottom: '1px solid #eef0f3',
                        transition: 'background 0.1s',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          style={{
                            padding: '12px 16px',
                            fontSize: 13,
                            // The locked column is the identity you click through on.
                            color: col.locked ? '#0062ff' : '#333',
                            fontWeight: col.locked ? 500 : 400,
                          }}
                        >
                          {renderTemplateCell(template, col.key)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Hidden while a profile is selected (narrow master pane) */}
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
            {/* `key` remounts the pane per profile, so the tab selection resets
                instead of carrying one profile's open tab onto another. */}
            <PermissionTemplateDetail
              key={selectedId}
              orgId={orgId}
              templateId={selectedId}
              onClose={() => setSearchParams({})}
              onDelete={(template) => setToDelete(template)}
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
        isOpen={!!toDelete}
        title={toDelete && toDelete.memberCount > 0 ? "Cannot delete profile" : "Delete profile"}
        message={
          toDelete && toDelete.memberCount > 0
            ? `"${toDelete.name}" is assigned to ${toDelete.memberCount} member(s). Move them to another profile first.`
            : `Delete "${toDelete?.name}"? This cannot be undone.`
        }
        confirmText={
          toDelete && toDelete.memberCount > 0
            ? "Got it"
            : deleteMutation.isPending
              ? 'Deleting...'
              : 'Delete'
        }
        onConfirm={() => {
          if (toDelete && toDelete.memberCount === 0) {
            deleteMutation.mutate(toDelete.id);
          } else {
            setToDelete(null);
          }
        }}
        onCancel={() => setToDelete(null)}
        isConfirming={deleteMutation.isPending}
        hideCancel={toDelete ? toDelete.memberCount > 0 : false}
      />
    </div>
  );
}
