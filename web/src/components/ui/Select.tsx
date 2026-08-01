import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Themed dropdown — a hand-built control, not a native `<select>`.
 *
 * WHY NOT `<select>`: a native select's OPEN list is drawn by the operating
 * system. `option` elements take almost no CSS, so however carefully the closed
 * box is themed, opening it shows a Windows/macOS listbox — different font,
 * colours and highlight from the rest of the app. The only way to theme the open
 * state is to render the list ourselves, which is also why this codebase builds
 * its own controls (CLAUDE.md: "No UI library; hand-built controls").
 *
 * Sized to match `.org-form-input` / `.org-form-select` (32px) so it lines up
 * with text inputs sat beside it.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled = false,
  hasError = false,
  minWidth = 140,
  /** Fill the parent (forms). Off for compact use like the pagination bar. */
  fullWidth = true,
  /**
   * Open the list upwards. Required when the control sits at the bottom of a
   * container that clips (`overflow: hidden`) — a downward panel is drawn outside
   * the box and simply never appears, which looks exactly like "it won't open".
   * The pagination bar is the case in point.
   */
  dropUp = false,
  ariaLabel,
  containerStyle,
  buttonStyle,
  actionItem,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  hasError?: boolean;
  minWidth?: number | string;
  fullWidth?: boolean;
  dropUp?: boolean;
  ariaLabel?: string;
  containerStyle?: React.CSSProperties;
  buttonStyle?: React.CSSProperties;
  actionItem?: React.ReactNode;
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

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} style={{ position: 'relative', minWidth, width: fullWidth ? '100%' : minWidth, ...containerStyle }}>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          width: '100%',
          height: 32,
          padding: '0 10px',
          background: disabled ? 'var(--color-bg)' : 'var(--color-surface-2)',
          border: `1px solid ${hasError ? 'var(--color-danger)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-sm)',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          color: selected ? 'var(--color-text)' : 'var(--color-text-subtle)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          textAlign: 'left',
          transition: 'all 0.2s ease',
          ...buttonStyle,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={14}
          color="var(--color-text-muted)"
          style={{
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : undefined,
            transition: 'transform 0.15s',
          }}
        />
      </button>

      {open && !disabled && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            ...(dropUp ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
            left: 0,
            right: 0,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            zIndex: 70,
            overflow: 'hidden auto',
            maxHeight: 260,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ overflow: 'hidden auto' }}>
            {options.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--color-text-subtle)' }}>
                No options
              </div>
            ) : (
              options.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      border: 'none',
                      background: isSelected ? 'var(--color-primary-soft)' : 'transparent',
                      fontFamily: 'var(--font-sans)',
                      fontSize: 13,
                      color: 'var(--color-text)',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'var(--color-surface-2)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    {opt.label}
                    {isSelected && <Check size={14} color="var(--color-primary)" />}
                  </button>
                );
              })
            )}
          </div>
          {actionItem && (
            <div style={{ borderTop: '1px solid var(--color-border)', padding: '4px' }} onClick={() => setOpen(false)}>
              {actionItem}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
