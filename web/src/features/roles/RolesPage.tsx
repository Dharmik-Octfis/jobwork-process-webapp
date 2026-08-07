import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Lock, Users, ShieldCheck, X } from 'lucide-react';
import { toApiErrorMessage } from '../../api/client';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Select } from '../../components/ui/Select';
import { rolesApi, type Role } from './roles.api';
import { membersApi, isMember } from '../members/members.api';
import '../organizations/CreateOrganizationForm.css';

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

  const assignedMembers = membersData?.results.filter(
    (u) => isMember(u) && u.roleId === viewingMembersFor
  ) ?? [];

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

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 'var(--space-6) var(--space-5)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 'var(--space-5)',
        }}
      >
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 var(--space-1) 0' }}>Roles</h2>
          <p style={{ color: 'var(--color-text-muted)', margin: 0, fontSize: 14 }}>
            A role is a job title — what someone is here to do. It grants no access on its own. What
            a member may <em>do</em> comes from their permission template, assigned separately.
          </p>
        </div>
        <button
          onClick={() => openForm('new')}
          style={{
            background: 'var(--color-primary)',
            color: 'white',
            border: 'none',
            padding: '10px 16px',
            borderRadius: 'var(--radius-md)',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            whiteSpace: 'nowrap',
          }}
        >
          <Plus size={16} /> New role
        </button>
      </div>

      {/* The one thing an admin needs to know before they start ticking nothing:
          this page has no permissions on it, and where the permissions are. */}
      <Link
        to={`/organizations/${orgId}/settings/permissions`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          marginBottom: 'var(--space-5)',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          fontSize: 13,
          color: 'var(--color-text)',
          textDecoration: 'none',
        }}
      >
        <ShieldCheck size={16} style={{ flexShrink: 0, color: 'var(--color-primary)' }} />
        <span>
          Looking for permissions? They live in{' '}
          <strong style={{ color: 'var(--color-primary)' }}>Settings → Permissions</strong> and are
          assigned to a member independently of their role.
        </span>
      </Link>

      {serverError && (
        <div
          style={{
            padding: 12,
            background: 'var(--danger-50)',
            color: 'var(--color-danger)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 20,
            fontSize: 14,
          }}
        >
          {serverError}
        </div>
      )}

      {editing && (
        <section
          style={{
            background: 'var(--color-surface)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)',
            padding: 'var(--space-6)',
            marginBottom: 'var(--space-5)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 'var(--space-4)',
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
              {editing === 'new' ? 'New role' : `Edit "${editing.name}"`}
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
                    // A role cannot be its own parent, and cannot move under one of
                    // its own descendants — that is a cycle. The server refuses both
                    // with a readable message; filtering the obvious self-case here
                    // just avoids offering it.
                    .filter((r) => !(editing !== 'new' && editing && r.id === editing.id))
                    .map((r) => ({
                      value: r.id,
                      // The list arrives as a depth-first walk, so `depth` alone
                      // renders the shape of the chart in a flat control.
                      label: `${'  '.repeat(r.depth)}${r.depth > 0 ? '└ ' : ''}${r.name}`,
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
                  : 'Save changes'}
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
        </section>
      )}

      <section
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
        }}
      >
        {isLoading ? (
          <div style={{ padding: 'var(--space-6)', color: 'var(--color-text-muted)' }}>
            Loading…
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {roles?.map((role) => (
              <li
                key={role.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: 'var(--space-4) var(--space-6)',
                  borderBottom: '1px solid var(--color-border)',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    minWidth: 0,
                    // The list arrives as a depth-first walk of the org chart, so a
                    // left inset per level renders the tree with no grouping pass.
                    paddingLeft: role.depth * 20,
                  }}
                >
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {role.depth > 0 && (
                      <span
                        aria-hidden="true"
                        style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}
                      >
                        └
                      </span>
                    )}
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
                          color: 'var(--color-text-muted)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 999,
                          padding: '2px 8px',
                        }}
                      >
                        <Lock size={11} /> Built-in
                      </span>
                    )}
                  </div>
                  {role.description && (
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {role.description}
                    </div>
                  )}
                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={() => setViewingMembersFor(viewingMembersFor === role.id ? null : role.id)}
                      style={{
                        fontSize: 12,
                        color: '#0062ff',
                        marginTop: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        fontWeight: 500,
                      }}
                    >
                      <Users size={12} />
                      {role.memberCount} member{role.memberCount === 1 ? '' : 's'}
                    </button>
                  </div>
                </div>

                {!role.isSystem && (
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => openForm(role)}
                      title="Edit role"
                      style={iconButtonStyle('var(--color-text)')}
                    >
                      <Pencil size={14} /> Edit
                    </button>
                    <button
                      onClick={() => setToDelete(role)}
                      title="Delete role"
                      style={iconButtonStyle('var(--color-danger)')}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {!isLoading && customRoles.length === 0 && (
          <div
            style={{ padding: 'var(--space-6)', color: 'var(--color-text-muted)', fontSize: 14 }}
          >
            No roles yet besides the built-in one. Create the job titles your team uses.
          </div>
        )}
      </section>

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
          onClick={(e) => { e.stopPropagation(); setViewingMembersFor(null); }}
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
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef0f3', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#0f172a' }}>{viewingRole.name} — Assigned Members</h3>
              <button onClick={() => setViewingMembersFor(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b', padding: 4 }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ padding: 0, overflowY: 'auto', flex: 1 }}>
              {isLoadingMembers ? (
                <div style={{ padding: '32px', fontSize: 13, color: '#64748b', textAlign: 'center' }}>Loading...</div>
              ) : assignedMembers.length === 0 ? (
                <div style={{ padding: '48px 32px', fontSize: 13, color: '#64748b', textAlign: 'center' }}>This role is not assigned to anyone</div>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {assignedMembers.map(member => (
                    <li key={member.id} style={{ display: 'flex', flexDirection: 'column', padding: '12px 20px', borderBottom: '1px solid #f8fafc' }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: '#1e293b' }}>{member.fullName}</span>
                      <span style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{member.email}</span>
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
        title={toDelete && toDelete.memberCount > 0 ? "Cannot delete role" : "Delete role"}
        message={
          toDelete && toDelete.memberCount > 0
            ? `"${toDelete.name}" is assigned to ${toDelete.memberCount} member(s). Give them a different role first.`
            : `Delete "${toDelete?.name}"? This cannot be undone.`
        }
        confirmText={toDelete && toDelete.memberCount > 0 ? "Got it" : "Delete"}
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

function iconButtonStyle(color: string) {
  return {
    background: 'white',
    color,
    border: `1px solid ${color === 'var(--color-danger)' ? 'var(--color-danger)' : 'var(--color-border)'}`,
    padding: '6px 12px',
    borderRadius: 'var(--radius-md)',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
  } as const;
}
