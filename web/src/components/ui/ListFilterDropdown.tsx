import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/**
 * The list's preset-view picker — the "All Vendors ▾" heading that doubles as a
 * filter. Options come from the server (listFilters.catalog.ts) so labels live in
 * one place, and the choice rides the URL as `?filter=`.
 *
 * Deliberately just the built-in presets: no "New View" / custom filter builder
 * yet. When that lands it becomes an extra row here.
 */
export function ListFilterDropdown({
  filters,
  value,
  onChange,
  fallbackLabel,
}: {
  filters: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  /** Shown before the server's options arrive (e.g. "All Vendors"). */
  fallbackLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const active = filters.find((f) => f.key === value);
  const label = active?.label ?? fallbackLabel;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={filters.length === 0}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: filters.length === 0 ? 'default' : 'pointer',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
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
          {label}
        </h1>
        <ChevronDown
          size={16}
          color="#0062ff"
          strokeWidth={2.5}
          style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s', flexShrink: 0 }}
        />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            minWidth: 230,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
            zIndex: 60,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '8px 14px',
              fontSize: 11,
              fontWeight: 600,
              color: '#64748b',
              textTransform: 'uppercase',
              background: '#f9f9fb',
              borderBottom: '1px solid #eef0f3',
            }}
          >
            Filters
          </div>
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                onChange(f.key);
                setOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                width: '100%',
                textAlign: 'left',
                padding: '10px 14px',
                border: 'none',
                background: f.key === value ? '#f1f5f9' : 'transparent',
                fontSize: 13,
                color: '#1e293b',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                if (f.key !== value) e.currentTarget.style.background = '#f8fafc';
              }}
              onMouseLeave={(e) => {
                if (f.key !== value) e.currentTarget.style.background = 'transparent';
              }}
            >
              {f.label}
              {f.key === value && <Check size={15} color="#0062ff" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
