import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { toApiErrorMessage } from '../../api/client';
import { permissionTemplatesApi, type PermissionTemplate } from './permissionTemplates.api';
import '../organizations/CreateOrganizationForm.css';

/** `vendor:create` → `vendor` / `create`. Resources may contain no colon, actions never do. */
const resourceOf = (key: string) => key.slice(0, key.lastIndexOf(':'));
const actionOf = (key: string) => key.slice(key.lastIndexOf(':') + 1);

/**
 * A checkbox that can also be "some of the below are ticked". `indeterminate` is
 * a DOM property, not an attribute, so React can't set it declaratively — hence
 * the ref. Used for the main-module rows, which summarise their children.
 */
function TriCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  title,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  title?: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !checked && indeterminate;
  }, [checked, indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      title={title}
      onChange={onChange}
      style={{
        width: 16,
        height: 16,
        cursor: disabled ? 'not-allowed' : 'pointer',
        // Ticked = granted, in the deep green reserved for it (see index.css).
        accentColor: 'var(--color-check)',
        opacity: disabled ? 0.65 : 1,
      }}
    />
  );
}

interface Props {
  orgId: string;
  /** null = creating a new template. */
  template: PermissionTemplate | null;
  onDone: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Create/edit a permission template — the bundle that decides what a member may
 * do. Nothing here is a job title: titles are roles, edited on Settings → Roles,
 * and assigned to a member independently of the template.
 *
 * The checkbox grid is rendered from the server's permission catalog, so a module
 * added in the backend appears here with no frontend change. The whole permission
 * set is saved at once — templates are edited wholesale.
 */
export function PermissionTemplateEditor({ orgId, template, onDone, onCancel }: Props) {
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  // Seed with View already implied, so a template saved before that rule existed
  // shows the same ticks it will have once saved again.
  const [selected, setSelected] = useState<Set<string>>(() => {
    const keys = template?.permissions ?? [];
    return new Set([...keys, ...keys.map((k) => `${resourceOf(k)}:read`)]);
  });
  const [error, setError] = useState<string | null>(null);
  /** Main modules folded shut, by group key. Everything starts open — a collapsed
   *  group would hide ticks the admin is reviewing. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapsed = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const { data: groups, isLoading } = useQuery({
    queryKey: ['permission-catalog', orgId],
    queryFn: () => permissionTemplatesApi.catalog(orgId),
    staleTime: 60 * 60 * 1000, // static vocabulary — no need to refetch
  });

  /**
   * The grid's columns: every action any module exposes, in the order the catalog
   * first mentions it. Most modules have all four, but a resource may expose fewer
   * (Organization Profile has no Create or Delete — you cannot create an org from
   * inside one, and deleting it is owner-only and outside the permission system).
   * Reading columns off the first module would then misalign every row, so they are
   * derived from the union and unsupported cells render as "—".
   */
  const columns = useMemo(() => {
    const seen = new Map<string, string>();
    for (const group of groups ?? []) {
      for (const module of group.modules) {
        for (const a of module.actions) {
          const action = actionOf(a.key);
          if (!seen.has(action)) seen.set(action, a.label);
        }
      }
    }
    return [...seen].map(([action, label]) => ({ action, label }));
  }, [groups]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        permissions: [...selected],
      };
      return template
        ? permissionTemplatesApi.update(orgId, template.id, body)
        : permissionTemplatesApi.create(orgId, body);
    },
    onSuccess: () => onDone(),
    onError: (err) => setError(toApiErrorMessage(err)),
  });

  /**
   * Tick or untick a set of permission keys, keeping View consistent: granting
   * Create/Edit/Delete grants View too (you can't act on a record you may not
   * open — the backend applies the same rule on save), and revoking View revokes
   * the rest of that module. Every checkbox on the grid — leaf, row, main module
   * — routes through here, so one rule covers them all.
   */
  const setKeys = (keys: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        const resource = resourceOf(key);
        if (on) {
          next.add(key);
          next.add(`${resource}:read`);
        } else {
          next.delete(key);
          if (actionOf(key) === 'read') {
            for (const action of ['create', 'update', 'delete']) {
              next.delete(`${resource}:${action}`);
            }
          }
        }
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
        <ChevronLeft size={16} /> Back to permissions
      </button>

      <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 var(--space-5) 0' }}>
        {template ? `Edit "${template.name}"` : 'New permission template'}
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
          <label>Template name</label>
          <input
            className="org-form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Warehouse — full access"
          />
        </div>
        <div className="org-form-group" style={{ flex: '2 1 320px', margin: 0 }}>
          <label>Description (optional)</label>
          <input
            className="org-form-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this level of access is for"
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
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '4px 0 0 0' }}>
            Ticking a main module applies that permission to every module under it. View is granted
            automatically whenever Create, Edit or Delete is — untick those first to remove it.
          </p>
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
                  {columns.map((c) => (
                    <th key={c.action} style={thStyle('center')}>
                      {c.label}
                    </th>
                  ))}
                  <th style={thStyle('center')}>All</th>
                </tr>
              </thead>
              <tbody>
                {groups?.map((group) => {
                  const groupKeys = group.modules.flatMap((m) => m.actions.map((a) => a.key));
                  const groupAllOn = groupKeys.every((k) => selected.has(k));
                  const groupAnyOn = groupKeys.some((k) => selected.has(k));
                  // View can't be cleared while something else in the group needs it.
                  const groupReadLocked = group.modules.some((m) =>
                    ['create', 'update', 'delete'].some((a) => selected.has(`${m.resource}:${a}`)),
                  );
                  const isCollapsed = collapsed.has(group.key);
                  const grantedModules = group.modules.filter((m) =>
                    m.actions.some((a) => selected.has(a.key)),
                  ).length;

                  return (
                    <Fragment key={group.key}>
                      {/* Main module — as it appears in the sidebar. Holds no
                          permission of its own; its checkboxes drive the rows below. */}
                      <tr
                        style={{
                          borderTop: '1px solid var(--color-border)',
                          // The band tints green once the group grants anything, so
                          // an admin can scan which main modules a role touches
                          // without reading a single checkbox.
                          background: groupAnyOn
                            ? 'var(--color-check-soft)'
                            : 'var(--color-surface-2)',
                        }}
                      >
                        <td
                          style={{
                            padding: 0,
                            fontWeight: 600,
                            // Left accent bar — the same on/off signal, at the edge
                            // where the eye tracks down the column.
                            boxShadow: `inset 3px 0 0 ${
                              groupAnyOn ? 'var(--color-check)' : 'var(--color-border-strong)'
                            }`,
                          }}
                        >
                          {/* The label is the collapse handle; the checkboxes in
                              the cells beside it stay independent of it. */}
                          <button
                            type="button"
                            onClick={() => toggleCollapsed(group.key)}
                            aria-expanded={!isCollapsed}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              width: '100%',
                              padding: '10px var(--space-6)',
                              background: 'none',
                              border: 'none',
                              font: 'inherit',
                              fontWeight: 600,
                              fontSize: 14,
                              letterSpacing: '0.01em',
                              color: groupAnyOn ? 'var(--color-check)' : 'var(--color-text)',
                              textAlign: 'left',
                              cursor: 'pointer',
                            }}
                          >
                            {/* Rotating chevron — same affordance as the sidebar's
                                module groups (AppLayout.ModuleNavGroup). */}
                            <span
                              style={{
                                display: 'flex',
                                transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                                transition: 'transform 0.2s ease',
                              }}
                            >
                              <ChevronRight size={14} />
                            </span>
                            {group.label}
                            {/* How much of the group is granted — the one number
                                worth keeping visible when the group is folded. */}
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '2px 8px',
                                borderRadius: 999,
                                color: groupAnyOn
                                  ? 'var(--color-check)'
                                  : 'var(--color-text-muted)',
                                background: groupAnyOn ? 'var(--color-surface)' : 'transparent',
                                border: `1px solid ${
                                  groupAnyOn ? 'var(--color-check-border)' : 'var(--color-border)'
                                }`,
                              }}
                            >
                              {grantedModules} / {group.modules.length}
                            </span>
                          </button>
                        </td>
                        {columns.map(({ action, label }) => {
                          // Only the modules that actually expose this action — a
                          // bulk toggle must not invent a key nothing checks.
                          const keys = group.modules
                            .filter((m) => m.actions.some((a) => actionOf(a.key) === action))
                            .map((m) => `${m.resource}:${action}`);
                          if (keys.length === 0) {
                            return <td key={action} style={emptyCellStyle} />;
                          }
                          const on = keys.every((k) => selected.has(k));
                          const some = keys.some((k) => selected.has(k));
                          // Only lock View when clicking it would *clear* it —
                          // a partly-ticked group must stay tickable.
                          const locked = action === 'read' && on && groupReadLocked;
                          return (
                            <td key={action} style={{ padding: '10px 0', textAlign: 'center' }}>
                              <TriCheckbox
                                checked={on}
                                indeterminate={some}
                                disabled={locked}
                                title={
                                  locked
                                    ? 'View is required by Create, Edit or Delete in this module.'
                                    : `${label} — all of ${group.label}`
                                }
                                onChange={() => setKeys(keys, !on)}
                              />
                            </td>
                          );
                        })}
                        <td style={{ padding: '10px 0', textAlign: 'center' }}>
                          <TriCheckbox
                            checked={groupAllOn}
                            indeterminate={groupAnyOn}
                            title={`Full access to ${group.label}`}
                            onChange={() => setKeys(groupKeys, !groupAllOn)}
                          />
                        </td>
                      </tr>

                      {/* Collapsed hides the rows, never the state — the main
                          module's own checkboxes still summarise what's ticked. */}
                      {!isCollapsed &&
                        group.modules.map((module) => {
                          const keys = module.actions.map((a) => a.key);
                          const allOn = keys.every((k) => selected.has(k));
                          const readLocked = ['create', 'update', 'delete'].some((a) =>
                            selected.has(`${module.resource}:${a}`),
                          );
                          return (
                            <tr
                              key={module.resource}
                              style={{ borderTop: '1px solid var(--color-border)' }}
                            >
                              <td
                                style={{
                                  padding: '10px var(--space-6) 10px calc(var(--space-6) + 20px)',
                                  fontWeight: 500,
                                  // Modules the role can't touch recede; the ones it
                                  // can read at full contrast.
                                  color: keys.some((k) => selected.has(k))
                                    ? 'var(--color-text)'
                                    : 'var(--color-text-muted)',
                                }}
                              >
                                {module.label}
                              </td>
                              {columns.map(({ action }) => {
                                const key = `${module.resource}:${action}`;
                                // This module doesn't expose the action at all —
                                // an em dash, so the row still lines up with the
                                // header and nobody hunts for a missing checkbox.
                                if (!keys.includes(key)) {
                                  return (
                                    <td
                                      key={action}
                                      title="Not applicable to this module"
                                      style={emptyCellStyle}
                                    >
                                      —
                                    </td>
                                  );
                                }
                                const locked = action === 'read' && selected.has(key) && readLocked;
                                return (
                                  <td
                                    key={action}
                                    style={{ padding: '10px 0', textAlign: 'center' }}
                                  >
                                    <TriCheckbox
                                      checked={selected.has(key)}
                                      disabled={locked}
                                      title={
                                        locked
                                          ? 'View is required by Create, Edit or Delete.'
                                          : undefined
                                      }
                                      onChange={() => setKeys([key], !selected.has(key))}
                                    />
                                  </td>
                                );
                              })}
                              <td style={{ padding: '10px 0', textAlign: 'center' }}>
                                <TriCheckbox
                                  checked={allOn}
                                  indeterminate={keys.some((k) => selected.has(k))}
                                  title={`Full access to ${module.label}`}
                                  onChange={() => setKeys(keys, !allOn)}
                                />
                              </td>
                            </tr>
                          );
                        })}
                    </Fragment>
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
              setError('Template name is required.');
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
          {saveMutation.isPending ? 'Saving…' : template ? 'Save changes' : 'Create template'}
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

/** A cell for an action the module doesn't have. Muted, so the eye skips it. */
const emptyCellStyle = {
  padding: '10px 0',
  textAlign: 'center',
  color: 'var(--color-border-strong)',
  fontSize: 13,
} as const;

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
