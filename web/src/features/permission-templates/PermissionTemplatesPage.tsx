import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Lock, Users, IdCard } from 'lucide-react';
import { toApiErrorMessage } from '../../api/client';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { permissionTemplatesApi, type PermissionTemplate } from './permissionTemplates.api';
import { PermissionTemplateEditor } from './PermissionTemplateEditor';
import '../organizations/CreateOrganizationForm.css';

/**
 * Settings → Permissions. A permission template is a named bundle of permissions
 * and the only thing that decides what a member may do. A new organization has
 * exactly one (Owner), so this page is where the owner builds the rest before
 * inviting anyone.
 *
 * Permissions are never granted per user — they belong to a template, and a
 * member is put on a template. A member's job title is a separate thing entirely
 * (Settings → Roles), assigned independently: same title, different access is
 * normal, and so is the reverse.
 */
export function PermissionTemplatesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<PermissionTemplate | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<PermissionTemplate | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const templatesKey = ['permission-templates', orgId];
  const { data: templates, isLoading } = useQuery({
    queryKey: templatesKey,
    queryFn: () => permissionTemplatesApi.list(orgId!),
    enabled: Boolean(orgId),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => permissionTemplatesApi.remove(orgId!, id),
    onSuccess: async () => {
      setServerError(null);
      await queryClient.invalidateQueries({ queryKey: templatesKey });
    },
    onError: (err) => setServerError(toApiErrorMessage(err)),
  });

  if (!orgId) return null;

  if (editing) {
    return (
      <PermissionTemplateEditor
        orgId={orgId}
        template={editing === 'new' ? null : editing}
        onDone={async () => {
          setEditing(null);
          await queryClient.invalidateQueries({ queryKey: templatesKey });
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  const customTemplates = templates?.filter((t) => !t.isSystem) ?? [];

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
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 var(--space-1) 0' }}>
            Permissions
          </h2>
          <p style={{ color: 'var(--color-text-muted)', margin: 0, fontSize: 14 }}>
            A permission template is a set of permissions. Members are put on a template —
            permissions are never granted to one person directly. Create one before inviting
            someone.
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
          <Plus size={16} /> New template
        </button>
      </div>

      {/* The counterpart of the pointer on the Roles page — the two screens are
          halves of one idea, and an admin who lands on the wrong one should be
          told so rather than left hunting. */}
      <Link
        to={`/organizations/${orgId}/settings/roles`}
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
        <IdCard size={16} style={{ flexShrink: 0, color: 'var(--color-primary)' }} />
        <span>
          Job titles live in{' '}
          <strong style={{ color: 'var(--color-primary)' }}>Settings → Roles</strong> and are
          assigned to a member independently — the same title can hold different access.
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
            {templates?.map((template) => (
              <li
                key={template.id}
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
                    {template.name}
                    {template.isSystem && (
                      <span
                        title="Built-in template — cannot be edited or deleted"
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
                    {template.description}
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
                    {template.memberCount} member{template.memberCount === 1 ? '' : 's'}
                    {' · '}
                    {template.grantsAllPermissions
                      ? 'All permissions'
                      : `${template.permissions.length} permissions`}
                  </div>
                </div>

                {!template.isSystem && (
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => setEditing(template)}
                      title="Edit template"
                      style={iconButtonStyle('var(--color-text)')}
                    >
                      <Pencil size={14} /> Edit
                    </button>
                    <button
                      onClick={() => setToDelete(template)}
                      title="Delete template"
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

        {!isLoading && customTemplates.length === 0 && (
          <div
            style={{
              padding: 'var(--space-6)',
              color: 'var(--color-text-muted)',
              fontSize: 14,
            }}
          >
            No permission templates yet besides Owner. Create one to invite teammates.
          </div>
        )}
      </section>

      <ConfirmDialog
        isOpen={!!toDelete}
        title="Delete permission template"
        message={
          toDelete && toDelete.memberCount > 0
            ? `"${toDelete.name}" is assigned to ${toDelete.memberCount} member(s). Move them to another template first.`
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
