import { useState, Fragment } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Lock, Users, ShieldCheck, X, SlidersHorizontal, Info} from 'lucide-react';
import { toApiErrorMessage } from '../../api/client';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Select } from '../../components/ui/Select';
import { rolesApi, type Role } from './roles.api';
import { membersApi, isMember } from '../members/members.api';
import '../organizations/CreateOrganizationForm.css';
import '../users/Users.css';

/**
 * Settings → Roles. A role is a job title and nothing more: it grants no access.
 * Two people with the same title routinely need different access, so what someone
 * may DO is a permission template, assigned separately on Settings → Permissions.
 *
 * The form is inline rather than a full-page editor — there are only two fields,
 * and pushing a page transition for a name and a sentence is more ceremony than
 * the task deserves. (Permissions, with a hundred checkboxes, does get its own page.)
 */
export function RolesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  /** '' = a root of the org chart. Structure only — a parent grants its children
   * nothing; access still comes solely from the permission template. */
  const [parentRoleId, setParentRoleId] = useState('');
  const [toDelete, setToDelete] = useState<Role | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [viewingMembersFor, setViewingMembersFor] = useState<string | null>(null);

  const rolesKey = ['roles', orgId];
  const { data: roles, isLoading } = useQuery({
    queryKey: rolesKey,
    queryFn: () => rolesApi.list(orgId!),
    enabled: Boolean(orgId),
  });

  const { data: membersData, isLoading: isLoadingMembers } = useQuery({
    queryKey: ['role-members', orgId, viewingMembersFor],
    queryFn: () => membersApi.list(orgId!, { filter: 'all_users', perPage: 500 }),
    enabled: Boolean(viewingMembersFor),
  });

  const assignedMembers =
    membersData?.results.filter((u) => isMember(u) && u.roleId === viewingMembersFor) ?? [];

  const openForm = (role: Role | 'new') => {
    setServerError(null);
    setEditing(role);
    setName(role === 'new' ? '' : role.name);
    setDescription(role === 'new' ? '' : (role.description ?? ''));
    setParentRoleId(role === 'new' ? '' : (role.parentRoleId ?? ''));
  };

  const closeForm = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setParentRoleId('');
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        // null, not undefined: undefined means "don't change it", null means
        // "promote this to a root". Sending undefined would make un-parenting a
        // role impossible.
        parentRoleId: parentRoleId || null,
      };
      return editing && editing !== 'new'
        ? rolesApi.update(orgId!, editing.id, body)
        : rolesApi.create(orgId!, body);
    },
    onSuccess: async () => {
      setServerError(null);
      closeForm();
      await queryClient.invalidateQueries({ queryKey: rolesKey });
    },
    onError: (err) => {
      const msg = toApiErrorMessage(err);
      if (msg !== 'A role with this name already exists.') {
        setServerError(msg);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rolesApi.remove(orgId!, id),
    onSuccess: async () => {
      setServerError(null);
      setToDelete(null);
      await queryClient.invalidateQueries({ queryKey: rolesKey });
    },
    onError: (err) => setServerError(toApiErrorMessage(err)),
  });

  if (!orgId) return null;

  const customRoles = roles?.filter((r) => !r.isSystem) ?? [];
  const viewingRole = roles?.find((r) => r.id === viewingMembersFor) ?? null;

  const rootRoles = (roles ?? []).filter((r) => !r.parentRoleId);
  const getChildRoles = (parentId: string) => (roles ?? []).filter((r) => r.parentRoleId === parentId);

  const renderRoleRow = (role: Role, depth = 0, isLastArray: boolean[] = []) => {
    const children = getChildRoles(role.id);
    const hasChildren = children.length > 0;

    return (
      <Fragment key={role.id}>
        <tr
          style={{
            borderBottom: '1px solid #eef0f3',
            transition: 'background 0.1s',
            background: 'transparent',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <td style={{ padding: 0 }} title={role.name}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 48, paddingLeft: depth * 32 + 40, paddingRight: 24, maxWidth: 300, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {/* 1. Vertical lines for passing-through ancestors */}
              {Array.from({ length: Math.max(0, depth - 1) }).map((_, i) => {
                if (isLastArray[i]) return null;
                return (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: i * 32 + 24 + 5.5,
                      top: 0,
                      bottom: -1,
                      width: 1,
                      background: '#cbd5e1',
                    }}
                  />
                );
              })}

              {/* 2. L-connector from parent to current node (if not root) */}
              {depth > 0 && (
                <>
                  <div
                    style={{
                      position: 'absolute',
                      left: (depth - 1) * 32 + 24 + 5.5,
                      top: 0,
                      bottom: isLastArray[depth - 1] ? '50%' : -1,
                      width: 1,
                      background: '#cbd5e1',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: (depth - 1) * 32 + 24 + 5.5,
                      top: '50%',
                      width: 32,
                      height: 1,
                      background: '#cbd5e1',
                    }}
                  >
                    {/* CSS Triangle Arrowhead */}
                    <div
                      style={{
                        position: 'absolute',
                        right: -4,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: 0,
                        height: 0,
                        borderTop: '3.5px solid transparent',
                        borderBottom: '3.5px solid transparent',
                        borderLeft: '4.5px solid #cbd5e1',
                      }}
                    />
                  </div>
                </>
              )}

              {/* 3. Line going down to children from THIS node (if it has children) */}
              {hasChildren && (
                <div
                  style={{
                    position: 'absolute',
                    left: depth * 32 + 24 + 5.5,
                    top: '50%',
                    bottom: -1,
                    width: 1,
                    background: '#cbd5e1',
                  }}
                />
              )}

              <span style={{ color: '#0062ff', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                {role.name}
                {role.isSystem && (
                  <span
                    title="Built-in role — cannot be edited or deleted"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#475569',
                      background: '#f1f5f9',
                      border: '1px solid #e2e8f0',
                      borderRadius: 999,
                      padding: '2px 8px',
                    }}
                  >
                    <Lock size={11} /> Built-in
                  </span>
                )}
              </span>
            </div>
          </td>
          <td className="col-description" style={{ padding: '12px 16px', fontSize: 13, color: '#64748b', maxWidth: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={role.description ?? undefined}>
            {role.description || '-'}
          </td>
          <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748b' }}>
            {role.memberCount === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Users size={14} color="#94a3b8" style={{ flexShrink: 0 }} />
                <span style={{ color: '#94a3b8' }} className="col-members-text">No members yet</span>
              </div>
            ) : (
              <button
                onClick={() => setViewingMembersFor(viewingMembersFor === role.id ? null : role.id)}
                style={{
                  fontSize: 13,
                  color: '#2563eb',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  fontWeight: 500,
                }}
                title={`${role.memberCount} members`}
              >
                <Users size={14} style={{ flexShrink: 0 }} />
                <span className="col-members-text">{role.memberCount} member{role.memberCount === 1 ? '' : 's'}</span>
              </button>
            )}
          </td>
          <td style={{ padding: '12px 16px', fontSize: 13 }}>
            {role.isSystem ? (
              <span style={{ color: '#94a3b8', fontSize: 13, fontWeight: 500 }}>Locked</span>
            ) : (
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  onClick={() => openForm(role)}
                  title="Edit role"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#475569',
                    padding: 0,
                    display: 'flex',
                  }}
                >
                  <Pencil size={15} />
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    onClick={() => {
                      if (role.memberCount === 0) {
                        setToDelete(role);
                      }
                    }}
                    title={role.memberCount > 0 ? undefined : "Delete role"}
                    disabled={role.memberCount > 0}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: role.memberCount > 0 ? 'not-allowed' : 'pointer',
                      color: role.memberCount > 0 ? '#cbd5e1' : '#ef4444',
                      padding: 0,
                      display: 'flex',
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                  {role.memberCount > 0 && (
                    <span className="users-tooltip-wrapper" style={{ display: 'inline-flex' }}>
                      <Info size={14} color="#94a3b8" />
                      <span className="users-tooltip-text">Reassign members before deleting.</span>
                    </span>
                  )}
                </div>
              </div>
            )}
          </td>
        </tr>
        {hasChildren && children.map((child, index) => renderRoleRow(child, depth + 1, [...isLastArray, index === children.length - 1]))}
      </Fragment>
    );
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @keyframes fadeInOverlay {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideDownModal {
          from { opacity: 0; transform: translateY(-15px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 768px) {
          .col-description { display: none !important; }
          .col-members-text { display: none !important; }
        }
      `}</style>

      {serverError && (
        <div
          style={{
            padding: 12,
            background: 'var(--danger-50)',
            color: 'var(--color-danger)',
            fontSize: 14,
          }}
        >
          {serverError}
        </div>
      )}

      {editing && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.45)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: 0,
            zIndex: 100,
            animation: 'fadeInOverlay 0.3s ease-out forwards',
          }}
          onClick={(e) => {
            e.stopPropagation();
            closeForm();
          }}
        >
          <div
            style={{
              width: 500,
              maxWidth: '92vw',
              background: '#fff',
              borderRadius: '0 0 8px 8px',
              boxShadow: '0 20px 45px rgba(0,0,0,0.22)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'visible',
              textAlign: 'left',
              padding: 'var(--space-6)',
              animation: 'slideDownModal 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 'var(--space-4)',
                gap: 16,
              }}
            >
              <h3
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  margin: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={editing === 'new' ? 'New role' : 'Edit role'}
              >
                {editing === 'new' ? 'New role' : 'Edit role'}
              </h3>
              <button
                onClick={closeForm}
                title="Cancel"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                  display: 'flex',
                  padding: 4,
                  flexShrink: 0,
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
              <div className="org-form-group" style={{ flex: '1 1 240px', margin: 0 }}>
                <label>Role name</label>
                <input
                  className="org-form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Warehouse Supervisor"
                />
              </div>
              <div className="org-form-group" style={{ flex: '2 1 320px', margin: 0 }}>
                <label>Description (optional)</label>
                <input
                  className="org-form-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this job is"
                />
              </div>
              <div className="org-form-group" style={{ flex: '1 1 260px', margin: 0 }}>
                <label>Reports to (optional)</label>
                <Select
                  value={parentRoleId}
                  onChange={setParentRoleId}
                  options={[
                    { value: '', label: 'Top level — reports to nobody' },
                    ...(roles ?? [])
                      .filter((r) => !(editing !== 'new' && editing && r.id === editing.id))
                      .map((r) => ({
                        value: r.id,
                        label: `${'\u00A0\u00A0\u00A0\u00A0'.repeat(r.depth)}${r.depth > 0 ? '└ ' : ''}${r.name}`,
                      })),
                  ]}
                  ariaLabel="Reports to"
                />
                <p
                  style={{
                    margin: '6px 0 0',
                    fontSize: 11.5,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  Sets the reporting structure only. A parent role grants no access to anything —
                  permissions come from the permission template.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 'var(--space-5)' }}>
              <button
                onClick={() => {
                  setServerError(null);
                  if (!name.trim()) {
                    setServerError('Role name is required.');
                    return;
                  }
                  saveMutation.mutate();
                }}
                disabled={saveMutation.isPending}
                style={{
                  background: 'var(--color-primary)',
                  color: 'white',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 600,
                  cursor: saveMutation.isPending ? 'not-allowed' : 'pointer',
                  opacity: saveMutation.isPending ? 0.7 : 1,
                }}
              >
                {saveMutation.isPending
                  ? 'Saving…'
                  : editing === 'new'
                    ? 'Create role'
                    : 'Save'}
              </button>
              <button
                onClick={closeForm}
                style={{
                  background: 'white',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                  padding: '10px 20px',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#f8fafc' }}>
        <div
          style={{
            flex: 1,
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
              Roles
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button
                disabled
                title="Customize Columns"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 30,
                  height: 30,
                  borderRadius: 4,
                  border: '1px solid #e2e8f0',
                  background: '#fff',
                  cursor: 'not-allowed',
                  color: '#94a3b8',
                }}
              >
                <SlidersHorizontal size={15} />
              </button>
              <button
                onClick={() => openForm('new')}
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
                <Plus size={16} /> New role
              </button>
            </div>
          </header>

          <div style={{ flex: 1, overflowY: 'auto', scrollbarGutter: 'stable' }}>
            <div style={{ padding: '10px 24px', background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)', fontSize: 13, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <ShieldCheck size={16} style={{ flexShrink: 0, color: 'var(--color-primary)' }} />
              <span>
                Looking for permissions? They live in{' '}
                <Link to={`/organizations/${orgId}/settings/permissions`} style={{ color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'none' }}>Settings → Permissions</Link> and are
                assigned to a member independently of their role.
              </span>
            </div>

            {isLoading ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                Loading roles...
              </div>
            ) : customRoles.length === 0 && (!roles || roles.length <= 1) ? (
              <div style={{ padding: '48px 32px', textAlign: 'center', color: '#64748b' }}>
                No roles yet besides the built-in one. Create the job titles your team uses.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', tableLayout: 'fixed' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#f9f9fb' }}>
                  <tr
                    style={{
                      borderBottom: '1px solid #eef0f3',
                    }}
                  >
                    <th style={{ padding: '12px 24px', fontSize: 13, fontWeight: 600, color: '#475569', width: '20%' }}>Name</th>
                    <th className="col-description" style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#475569', width: '45%' }}>Description</th>
                    <th style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#475569', width: '20%' }}>Members</th>
                    <th style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#475569', width: '15%' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rootRoles.map((role) => renderRoleRow(role, 0))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {viewingRole && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.45)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: 0,
            zIndex: 100,
          }}
          onClick={(e) => {
            e.stopPropagation();
            setViewingMembersFor(null);
          }}
        >
          <div
            style={{
              width: 500,
              maxWidth: '92vw',
              maxHeight: '80vh',
              background: '#fff',
              borderRadius: '0 0 8px 8px',
              boxShadow: '0 20px 45px rgba(0,0,0,0.22)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              textAlign: 'left',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid #eef0f3',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
                {viewingRole.name} — Assigned Members
              </h3>
              <button
                onClick={() => setViewingMembersFor(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#64748b',
                  padding: 4,
                }}
              >
                <X size={18} />
              </button>
            </div>
            <div style={{ padding: 0, overflowY: 'auto', flex: 1 }}>
              {isLoadingMembers ? (
                <div
                  style={{ padding: '32px', fontSize: 13, color: '#64748b', textAlign: 'center' }}
                >
                  Loading...
                </div>
              ) : assignedMembers.length === 0 ? (
                <div
                  style={{
                    padding: '48px 32px',
                    fontSize: 13,
                    color: '#64748b',
                    textAlign: 'center',
                  }}
                >
                  This role is not assigned to anyone
                </div>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {assignedMembers.map((member) => (
                    <li
                      key={member.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        padding: '12px 20px',
                        borderBottom: '1px solid #f8fafc',
                      }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 500, color: '#1e293b' }}>
                        {member.fullName}
                      </span>
                      <span style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                        {member.email}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!toDelete}
        title={toDelete && toDelete.memberCount > 0 ? 'Cannot delete role' : 'Delete role'}
        message={
          toDelete && toDelete.memberCount > 0
            ? `"${toDelete.name}" is assigned to ${toDelete.memberCount} member(s). Give them a different role first.`
            : `Delete "${toDelete?.name}"? This cannot be undone.`
        }
        confirmText={toDelete && toDelete.memberCount > 0 ? 'Got it' : 'Delete'}
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
