import { useMemo, useState } from 'react';
import { GripVertical, Lock, Search, X } from 'lucide-react';
import type { ColumnDef } from '../../features/list-views/listViews.api';

interface Row extends ColumnDef {
  checked: boolean;
}

/**
 * Shared "Customize Columns" picker for every module's list.
 *
 * Order in this list IS the column order, so the rows are a single ordered array
 * (selected first, then the unselected rest) that the user drags to rearrange.
 *
 * LOCKED columns are the row's identity: rendered with a lock instead of a
 * checkbox, pinned to the top, and not draggable. The server re-asserts them on
 * save too, so the rule holds even if this UI is bypassed.
 */
export function CustomizeColumnsModal({
  isOpen,
  onClose,
  catalog,
  visible,
  onSave,
  isSaving,
}: {
  isOpen: boolean;
  onClose: () => void;
  catalog: ColumnDef[];
  visible: string[];
  onSave: (columns: string[]) => void;
  isSaving?: boolean;
}) {
  // Seed from the saved layout: visible keys in their saved order, then whatever
  // else the catalog offers. Keyed by the modal's open state via `resetKey`.
  const seed = useMemo<Row[]>(() => {
    const byKey = new Map(catalog.map((c) => [c.key, c]));
    const chosen = visible
      .map((k) => byKey.get(k))
      .filter((c): c is ColumnDef => Boolean(c))
      .map((c) => ({ ...c, checked: true }));
    const chosenKeys = new Set(chosen.map((c) => c.key));
    const rest = catalog
      .filter((c) => !chosenKeys.has(c.key))
      .map((c) => ({ ...c, checked: false }));
    return [...chosen, ...rest];
  }, [catalog, visible]);

  const [rows, setRows] = useState<Row[]>(seed);
  const [query, setQuery] = useState('');
  const [dragKey, setDragKey] = useState<string | null>(null);

  // Re-seed whenever the modal is (re)opened or the saved layout changes —
  // render-time reset, so a cancelled edit never leaks into the next open.
  const [prevSeedToken, setPrevSeedToken] = useState(`${isOpen}|${visible.join(',')}`);
  const seedToken = `${isOpen}|${visible.join(',')}`;
  if (seedToken !== prevSeedToken) {
    setPrevSeedToken(seedToken);
    setRows(seed);
    setQuery('');
  }

  if (!isOpen) return null;

  const selectedCount = rows.filter((r) => r.checked).length;
  const shown = query.trim()
    ? rows.filter((r) => r.label.toLowerCase().includes(query.trim().toLowerCase()))
    : rows;

  const toggle = (key: string) =>
    setRows((prev) =>
      prev.map((r) => (r.key === key && !r.locked ? { ...r, checked: !r.checked } : r)),
    );

  /** Move `dragKey` to sit where `overKey` is. Locked rows are never a target. */
  const dropOn = (overKey: string) => {
    if (!dragKey || dragKey === overKey) return;
    setRows((prev) => {
      const from = prev.findIndex((r) => r.key === dragKey);
      const to = prev.findIndex((r) => r.key === overKey);
      if (from < 0 || to < 0 || prev[to]?.locked || prev[from]?.locked) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  };

  const handleSave = () => onSave(rows.filter((r) => r.checked).map((r) => r.key));

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 60,
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 620,
          maxWidth: '92vw',
          background: '#fff',
          borderRadius: 8,
          boxShadow: '0 20px 45px rgba(0,0,0,0.22)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '80vh',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid #eef0f3',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#0f172a' }}>
            Customize Columns
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>
              {selectedCount} of {rows.length} Selected
            </span>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: '14px 20px 8px' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search
              size={15}
              color="#94a3b8"
              style={{ position: 'absolute', left: 11, pointerEvents: 'none' }}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              style={{
                width: '100%',
                padding: '8px 12px 8px 32px',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                fontSize: 13,
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Rows */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px 12px' }}>
          {shown.length === 0 ? (
            <div style={{ padding: '24px 4px', color: '#64748b', fontSize: 13 }}>
              No columns match &ldquo;{query}&rdquo;.
            </div>
          ) : (
            shown.map((row) => (
              <div
                key={row.key}
                draggable={!row.locked && !query}
                onDragStart={() => setDragKey(row.key)}
                onDragEnd={() => setDragKey(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropOn(row.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  marginBottom: 6,
                  background: '#f8fafc',
                  border: '1px solid #eef0f3',
                  borderRadius: 6,
                  opacity: dragKey === row.key ? 0.5 : 1,
                  cursor: row.locked || query ? 'default' : 'grab',
                }}
              >
                <GripVertical size={15} color={row.locked || query ? '#e2e8f0' : '#94a3b8'} />
                {row.locked ? (
                  <Lock size={14} color="#94a3b8" />
                ) : (
                  <input
                    type="checkbox"
                    checked={row.checked}
                    onChange={() => toggle(row.key)}
                    style={{ width: 15, height: 15, cursor: 'pointer' }}
                  />
                )}
                <span style={{ fontSize: 13, color: '#1e293b' }}>{row.label}</span>
                {row.locked && (
                  <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>
                    Always shown
                  </span>
                )}
              </div>
            ))
          )}
          {query && (
            <div style={{ fontSize: 11, color: '#94a3b8', padding: '2px 4px' }}>
              Clear the search to drag columns into a new order.
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{ display: 'flex', gap: 10, padding: '14px 20px', borderTop: '1px solid #eef0f3' }}
        >
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              background: '#0062ff',
              color: '#fff',
              border: 'none',
              padding: '8px 20px',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 500,
              cursor: isSaving ? 'default' : 'pointer',
              opacity: isSaving ? 0.7 : 1,
            }}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onClose}
            style={{
              background: '#fff',
              color: '#334155',
              border: '1px solid #e2e8f0',
              padding: '8px 20px',
              borderRadius: 4,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
