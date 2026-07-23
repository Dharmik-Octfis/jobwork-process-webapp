import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { toApiErrorMessage } from '../../api/client';
import { rolesApi, type Role } from './roles.api';
import '../organizations/CreateOrganizationForm.css';

interface Props {
  orgId: string;
  /** null = creating a new role. */
  role: Role | null;
  onDone: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Create/edit a role. The checkbox grid is rendered from the server's permission
 * catalog, so a module added in the backend appears here with no frontend change.
 * The whole permission set is saved at once — roles are edited wholesale.
 */
export function RoleEditor({ orgId, role, onDone, onCancel }: Props) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [error, setError] = useState<string | null>(null);

  const { data: groups, isLoading } = useQuery({
    queryKey: ['permission-catalog', orgId],
    queryFn: () => rolesApi.catalog(orgId),
    staleTime: 60 * 60 * 1000, // static vocabulary — no need to refetch
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        permissions: [...selected],
      };
      return role ? rolesApi.update(orgId, role.id, body) : rolesApi.create(orgId, body);
    },
    onSuccess: () => onDone(),
    onError: (err) => setError(toApiErrorMessage(err)),
  });

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** Tick/untick a whole resource row at once. */
  const toggleRow = (keys: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 'var(--space-6) var(--space-5)' }}>
      <button
        onClick={onCancel}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 13,
          fontWeight: 500,
          padding: 0,
          marginBottom: 'var(--space-4)',
        }}
      >
        <ChevronLeft size={16} /> Back to roles
      </button>

      <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 var(--space-5) 0' }}>
        {role ? `Edit "${role.name}"` : 'New role'}
      </h2>

      {error && (
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
          {error}
        </div>
      )}

      <section
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          padding: 'var(--space-6)',
          marginBottom: 'var(--space-5)',
          display: 'flex',
          gap: 'var(--space-4)',
          flexWrap: 'wrap',
        }}
      >
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
            placeholder="What this role is for"
          />
        </div>
      </section>

      <section
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: 'var(--space-4) var(--space-6)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Permissions</h3>
        </div>

        {isLoading ? (
          <div style={{ padding: 'var(--space-6)', color: 'var(--color-text-muted)' }}>
            Loading…
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: 'var(--color-bg)' }}>
                  <th style={thStyle('left')}>Module</th>
                  {(groups?.[0]?.actions ?? []).map((a) => (
                    <th key={a.key} style={thStyle('center')}>
                      {a.label}
                    </th>
                  ))}
                  <th style={thStyle('center')}>All</th>
                </tr>
              </thead>
              <tbody>
                {groups?.map((g) => {
                  const keys = g.actions.map((a) => a.key);
                  const allOn = keys.every((k) => selected.has(k));
                  return (
                    <tr key={g.resource} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '10px var(--space-6)', fontWeight: 500 }}>{g.label}</td>
                      {g.actions.map((a) => (
                        <td key={a.key} style={{ padding: '10px 0', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={selected.has(a.key)}
                            onChange={() => toggle(a.key)}
                            style={{ width: 16, height: 16, cursor: 'pointer' }}
                          />
                        </td>
                      ))}
                      <td style={{ padding: '10px 0', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={allOn}
                          onChange={() => toggleRow(keys, !allOn)}
                          style={{ width: 16, height: 16, cursor: 'pointer' }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div style={{ display: 'flex', gap: 12, marginTop: 'var(--space-5)' }}>
        <button
          onClick={() => {
            setError(null);
            if (!name.trim()) {
              setError('Role name is required.');
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
          {saveMutation.isPending ? 'Saving…' : role ? 'Save changes' : 'Create role'}
        </button>
        <button
          onClick={onCancel}
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
  );
}

function thStyle(align: 'left' | 'center') {
  return {
    padding: '10px var(--space-6)',
    textAlign: align,
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  } as const;
}
