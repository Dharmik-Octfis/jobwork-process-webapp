import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, SlidersHorizontal, Users as UsersIcon } from 'lucide-react';
import { organizationsApi } from '../organizations/organizations.api';
import { rolesApi } from '../roles/roles.api';
import { permissionTemplatesApi } from '../permission-templates/permissionTemplates.api';
import { membersApi, isMember, type OrgUser, type Member } from '../members/members.api';
import { useListSearch } from '../../hooks/useListSearch';
import { useListCount } from '../../hooks/useListCount';
import { useListColumns } from '../../hooks/useListColumns';
import { Pagination } from '../../components/ui/Pagination';
import { CustomizeColumnsModal } from '../../components/ui/CustomizeColumnsModal';
import { ListFilterDropdown } from '../../components/ui/ListFilterDropdown';
import { CUSTOM_FIELD_PREFIX } from '../list-views/listViews.api';
import { UserDetailPanel } from './UserDetailPanel';
import { NewUserModal } from './NewUserModal';
import './Users.css';

/**
 * Settings → **Users** (formerly "Members & Invites").
 *
 * Built from the same pieces as every other module list — `useListSearch`,
 * `useListColumns`, `ListFilterDropdown`, `CustomizeColumnsModal`, `Pagination`,
 * and a `?id=` detail panel — so it behaves identically to Vendors and Items and
 * inherits Customize Columns and per-org custom fields for free.
 *
 * 🔴 The names in this table are per-ORGANIZATION. They live on the membership, not
 * the account, so the same person can appear differently in another org and editing
 * one never touches the other.
 *
 * The filter dropdown defaults to **Active Users** because that is the first preset
 * the server serves for entity `member` (listFilters.catalog.ts) — the client does
 * not hardcode it. "Unconfirmed Users" is the one preset backed by `invitations`
 * rather than `memberships`; those rows have no profile until the person accepts.
 */

/**
 * How each selectable column renders. Keys match the backend catalog
 * (listViews.catalog.ts); anything prefixed `cf:` is a per-org custom field read out
 * of the row's `customFields` blob, so a new custom field needs no code here — and
 * its position in this table is the `display_order` an admin set by dragging it in
 * Settings → Modules → Users.
 */
function renderUserCell(
  user: OrgUser,
  key: string,
  onToggleStatus?: (user: Member) => void,
): React.ReactNode {
  if (key.startsWith(CUSTOM_FIELD_PREFIX)) {
    // Only a joined member has custom-field values; an invitation has no record yet.
    const values = isMember(user) ? user.customFields : undefined;
    const value = values?.[key.slice(CUSTOM_FIELD_PREFIX.length)];
    if (value === null || value === undefined || value === '') return '-';
    return Array.isArray(value) ? value.join(', ') : String(value);
  }

  switch (key) {
    case 'fullName':
      return user.fullName;
    case 'email':
      return user.email;
    case 'roleName':
      // The leaf of the org-chart path is the title itself; the full path
      // ("Owner › Manager › Supervisor") is shown in the detail pane.
      return user.rolePath.at(-1) ?? user.roleName ?? '-';
    case 'permissionTemplateName':
      return user.permissionTemplateName ?? '-';
    case 'status':
      if (!isMember(user)) {
        return user.inviteStatus === 'declined' ? 'Declined' : 'Unconfirmed';
      }
      if (user.isOwner) {
        return <span style={{ color: '#059669', fontWeight: 500 }}>Active</span>;
      }
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleStatus?.(user);
          }}
          style={{
            background: user.status === 'active' ? '#dcfce7' : '#fee2e2',
            color: user.status === 'active' ? '#166534' : '#991b1b',
            border: 'none',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {user.status === 'active' ? 'Active' : 'Inactive'}
        </button>
      );
    case 'addedByName':
      return user.addedByName;
    case 'phone':
      return isMember(user) ? (user.phone ?? '-') : '-';
    case 'mobile':
      return isMember(user) ? (user.mobile ?? '-') : '-';
    case 'dateOfBirth':
      // Parsed as UTC to match how a `date` column is stored — the local parser
      // renders the previous day west of UTC.
      return isMember(user) && user.dateOfBirth
        ? new Date(`${user.dateOfBirth}T00:00:00Z`).toLocaleDateString(undefined, {
            timeZone: 'UTC',
          })
        : '-';
    case 'joinedAt':
      return isMember(user)
        ? new Date(user.joinedAt).toLocaleDateString()
        : new Date(user.createdAt).toLocaleDateString();
    case 'updatedAt':
      return isMember(user) ? new Date(user.joinedAt).toLocaleDateString() : '-';
    default:
      return '-';
  }
}

export function UsersPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');

  // Search term (from the global top-bar box, via `?search=`) + filter + page
  // cursor, all from the shared hook so every list wires this the same way.
  const { search, filter, setFilter, perPage, setPerPage, page, setPage } = useListSearch();

  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    // orgId in the key or an org switch serves the previous tenant's cache;
    // search + filter + page so each combination is cached separately.
    queryKey: ['org-users', orgId, search, filter, page, perPage],
    queryFn: () => membersApi.list(orgId!, { search: search || undefined, filter, page, perPage }),
    enabled: Boolean(orgId),
    // Keep the current page visible while the next one loads.
    placeholderData: (prev) => prev,
  });

  const users = data?.results ?? [];
  const pageContext = data?.pageContext;

  const {
    total,
    isCounting,
    request: requestCount,
  } = useListCount(['org-users-count', orgId, search, filter], () =>
    membersApi.count(orgId!, { search: search || undefined, filter }),
  );

  // Column layout ("Customize Columns") — per user, per org, per module. `member`
  // is a registered entity type, so this is the same call vendors makes.
  const { catalog, visible, filters, columns, save: saveColumns } = useListColumns(orgId, 'member');
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  const [isNewOpen, setIsNewOpen] = useState(false);

  const { data: organizations } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
    staleTime: 5 * 60 * 1000,
  });
  const activeOrg = organizations?.find((o) => o.organizationId === orgId);

  const { data: me } = useQuery({
    queryKey: ['org-users-me', orgId],
    queryFn: () => membersApi.getMe(orgId!),
    enabled: Boolean(orgId),
    staleTime: 5 * 60 * 1000,
  });

  const { data: roles } = useQuery({
    queryKey: ['roles', orgId],
    queryFn: () => rolesApi.list(orgId!),
    enabled: Boolean(orgId),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: (user: Member) =>
      membersApi.update(orgId!, user.id, {
        isActive: user.status === 'inactive', // toggle it
      }),
    onSuccess: () => {
      // Invalidate the users list so it refetches
      queryClient.invalidateQueries({ queryKey: ['org-users', orgId] });
      queryClient.invalidateQueries({ queryKey: ['org-users-count', orgId] });
    },
  });

  const handleToggleStatus = (user: Member) => {
    toggleStatusMutation.mutate(user);
  };

  // `listAll`, not `list` — this feeds the assign/invite dropdowns, which have to
  // offer every profile at once and cannot page.
  const { data: templates } = useQuery({
    queryKey: ['permission-templates-all', orgId],
    queryFn: () => permissionTemplatesApi.listAll(orgId!),
    enabled: Boolean(orgId),
  });

  if (!orgId) return null;

  const selected = users.find((u) => u.id === selectedId) ?? null;

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
            <ListFilterDropdown
              filters={filters}
              value={filter}
              onChange={setFilter}
              fallbackLabel="Active Users"
            />

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
              {/* Adding a user IS sending an invitation — nobody gets a password set
                  for them — so this opens a window rather than routing to a create
                  page: there is no record to build yet, only an invite to address. */}
              <button
                onClick={() => setIsNewOpen(true)}
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

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isLoading && users.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                Loading users...
              </div>
            ) : users.length === 0 && search ? (
              <div style={{ padding: '48px 32px', textAlign: 'center', color: '#64748b' }}>
                No users match &ldquo;{search}&rdquo;.
              </div>
            ) : users.length === 0 ? (
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
                  <UsersIcon size={40} color="#94a3b8" />
                </div>
                <h2
                  style={{ fontSize: 20, fontWeight: 600, color: '#1e293b', margin: '0 0 8px 0' }}
                >
                  {filter === 'unconfirmed' ? 'No Pending Invitations' : 'No Users Here'}
                </h2>
                <p
                  style={{ color: '#64748b', maxWidth: 400, margin: '0 0 24px 0', lineHeight: 1.5 }}
                >
                  {filter === 'unconfirmed'
                    ? 'Everyone who was invited has either joined or been revoked.'
                    : 'Invite someone to this organization. They choose their own password from the link they receive.'}
                </p>
                <button
                  onClick={() => setIsNewOpen(true)}
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
                  Invite User
                </button>
              </div>
            ) : selectedId ? (
              // Narrow master pane beside the detail panel.
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {users.map((user) => (
                  <div
                    key={user.id}
                    onClick={() => setSearchParams({ id: user.id })}
                    style={{
                      padding: '12px 16px',
                      borderBottom: '1px solid #eef0f3',
                      cursor: 'pointer',
                      background: selectedId === user.id ? '#f1f5f9' : 'transparent',
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
                      {user.fullName}
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '2px' }}>
                      Role:-{user.rolePath?.at(-1) ?? user.roleName ?? '-'} ,{' '}
                      Profile:-{user.permissionTemplateName ?? '-'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>{user.email}</div>
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
                  {users.map((user) => (
                    <tr
                      key={user.id}
                      onClick={() => setSearchParams({ id: user.id })}
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
                          {renderUserCell(user, col.key, handleToggleStatus)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Hidden while a user is selected (narrow master pane) */}
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

        {selectedId && selected && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* `key` remounts the pane per person, which resets the edit form and its
                dirty state for free — without it, clicking a second name while
                editing a first shows one person's typed values under another's
                heading. */}
            <UserDetailPanel
              key={selected.id}
              orgId={orgId}
              organizationName={activeOrg?.name}
              user={selected}
              roles={roles ?? []}
              templates={templates ?? []}
              myMembershipId={me?.id ?? null}
              onDeselect={() => setSearchParams({})}
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

      {isNewOpen && (
        <NewUserModal
          orgId={orgId}
          organizationName={activeOrg?.name}
          roles={roles ?? []}
          templates={templates ?? []}
          onClose={() => setIsNewOpen(false)}
        />
      )}
    </div>
  );
}
