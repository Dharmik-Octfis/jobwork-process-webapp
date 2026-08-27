import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function MultiSelect({
  value,
  onChange,
  options,
  placeholder = '- Select -',
  buttonStyle,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  placeholder?: string;
  buttonStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const selectedValues = value ? value.split(',').filter(Boolean) : [];

  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) {
      document.addEventListener('mousedown', onDown);
    }
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggleVal = (v: string) => {
    let next = [...selectedValues];
    if (next.includes(v)) {
      next = next.filter((x) => x !== v);
    } else {
      next.push(v);
    }
    onChange(next.join(','));
  };

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', minWidth: '100px' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          height: 32,
          padding: '0 8px',
          fontSize: 13,
          fontWeight: 400,
          borderRadius: 4,
          border: '1px solid #cbd5e1',
          background: '#fff',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          ...buttonStyle,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedValues.length === 0
            ? placeholder
            : selectedValues.length === 1
            ? selectedValues[0]
            : `${selectedValues.length} selected`}
        </span>
        {open ? (
          <ChevronDown size={14} style={{ color: '#64748b' }} />
        ) : (
          <ChevronRight size={14} style={{ color: '#64748b' }} />
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            width: '100%',
            minWidth: '200px',
            maxHeight: '200px',
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            zIndex: 50,
            padding: '4px',
          }}
        >
          {options.length === 0 ? (
            <div style={{ padding: '8px', color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>
              No options available
            </div>
          ) : (
            options.map((opt) => (
              <label
                key={opt.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  cursor: 'pointer',
                  fontSize: 13,
                  borderRadius: 4,
                  userSelect: 'none',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <input
                  type="checkbox"
                  checked={selectedValues.includes(opt.value)}
                  onChange={() => toggleVal(opt.value)}
                />
                {opt.label}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
