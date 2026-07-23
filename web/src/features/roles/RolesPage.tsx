import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Lock, Users } from 'lucide-react';
import { toApiErrorMessage } from '../../api/client';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { rolesApi, type Role } from './roles.api';
import { RoleEditor } from './RoleEditor';
import '../organizations/CreateOrganizationForm.css';

/**
 * Settings → Roles. A new organization has exactly one role (Owner), so this page
 * is where the owner creates the roles they need before inviting anyone.
 *
 * Permissions are never granted per user — they belong to a role, and a member is
 * put on a role. To vary one person's access, make another role.
 */
export function RolesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<Role | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const rolesKey = ['permission-templates', orgId];
  const { data: roles, isLoading } = useQuery({
    queryKey: rolesKey,
    queryFn: () => rolesApi.list(orgId!),
    enabled: Boolean(orgId),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rolesApi.remove(orgId!, id),
    onSuccess: async () => {
      setServerError(null);
      await queryClient.invalidateQueries({ queryKey: rolesKey });
    },
    onError: (err) => setServerError(toApiErrorMessage(err)),
  });

  if (!orgId) return null;

  if (editing) {
    return (
      <RoleEditor
        orgId={orgId}
        role={editing === 'new' ? null : editing}
        onDone={async () => {
          setEditing(null);
          await queryClient.invalidateQueries({ queryKey: rolesKey });
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  const customRoles = roles?.filter((r) => !r.isSystem) ?? [];

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
            A role is a set of permissions. Members are assigned a role — permissions are never
            granted to one person directly. Create a role before inviting someone.
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
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
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
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
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {role.description}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--color-text-muted)',
                      marginTop: 4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Users size={12} />
                    {role.memberCount} member{role.memberCount === 1 ? '' : 's'}
                    {' · '}
                    {role.isOwner ? 'All permissions' : `${role.permissions.length} permissions`}
                  </div>
                </div>

                {!role.isSystem && (
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => setEditing(role)}
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
            style={{
              padding: 'var(--space-6)',
              color: 'var(--color-text-muted)',
              fontSize: 14,
            }}
          >
            No roles yet besides Owner. Create one to invite teammates.
          </div>
        )}
      </section>

      <ConfirmDialog
        isOpen={!!toDelete}
        title="Delete role"
        message={
          toDelete && toDelete.memberCount > 0
            ? `"${toDelete.name}" is assigned to ${toDelete.memberCount} member(s). Move them to another role first.`
            : `Delete "${toDelete?.name}"? This cannot be undone.`
        }
        confirmText="Delete"
        onConfirm={() => {
          if (toDelete) deleteMutation.mutate(toDelete.id);
          setToDelete(null);
        }}
        onCancel={() => setToDelete(null)}
        isConfirming={deleteMutation.isPending}
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
