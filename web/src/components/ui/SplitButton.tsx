import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronUp } from 'lucide-react';

/**
 * One primary action, with its variants behind a caret.
 *
 * 🔴 The two halves have SEPARATE disabled states, which is the whole reason
 * this is a component and not two buttons. A draft saves under looser rules than
 * a post, so the caret is routinely live while the primary is not — one
 * `disabled` for the pair would make the menu unreachable exactly when it is
 * wanted.
 *
 * Keyboard (CLAUDE.md): both halves are real buttons, ↑/↓ move through the menu
 * skipping disabled rows, Esc closes and returns focus to the caret, Tab closes,
 * a click outside closes. It opens UPWARD — it lives in a sticky footer, so
 * downward would render off-screen.
 */

export interface SplitButtonAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface Props {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  actions: SplitButtonAction[];
}

const GREEN = '#186337';

export function SplitButton({ label, onClick, disabled = false, actions }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const enabledIndexes = actions.flatMap((action, i) => (action.disabled ? [] : [i]));
  const canOpen = actions.length > 0;

  // Pointerdown, not click, so the menu is gone before whatever was clicked reacts.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Real focus follows the active row, not a painted highlight a reader cannot see.
  useLayoutEffect(() => {
    if (open) itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  const openMenu = () => {
    if (!canOpen) return;
    setActiveIndex(enabledIndexes[0] ?? 0);
    setOpen(true);
  };

  const closeMenu = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) caretRef.current?.focus();
  };

  const move = (delta: number) => {
    if (enabledIndexes.length === 0) return;
    const at = enabledIndexes.indexOf(activeIndex);
    const next = enabledIndexes[(at + delta + enabledIndexes.length) % enabledIndexes.length];
    setActiveIndex(next ?? enabledIndexes[0]!);
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      {open && (
        <div
          id={menuId}
          role="menu"
          onKeyDown={onMenuKeyDown}
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            minWidth: '100%',
            width: 'max-content',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
            padding: 4,
            zIndex: 30,
          }}
        >
          {actions.map((action, index) => (
            <button
              key={action.label}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              tabIndex={index === activeIndex ? 0 : -1}
              onClick={() => {
                closeMenu(false);
                action.onClick();
              }}
              onMouseEnter={() => !action.disabled && setActiveIndex(index)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                whiteSpace: 'nowrap',
                padding: '7px 12px',
                border: 'none',
                borderRadius: 4,
                background: index === activeIndex && !action.disabled ? '#f1f5f9' : 'transparent',
                color: action.disabled ? '#94a3b8' : '#0f172a',
                cursor: action.disabled ? 'not-allowed' : 'pointer',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        // Closes the menu first: the primary sits inside the wrapper, so the
        // click-outside handler never fires for it.
        onClick={() => {
          setOpen(false);
          onClick();
        }}
        disabled={disabled}
        style={{
          padding: '6px 20px',
          background: disabled ? '#f1f5f9' : GREEN,
          color: disabled ? '#94a3b8' : '#fff',
          border: 'none',
          borderTopLeftRadius: 4,
          borderBottomLeftRadius: 4,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontWeight: 500,
          fontSize: 13,
        }}
      >
        {label}
      </button>
      <button
        ref={caretRef}
        type="button"
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' && !open) {
            event.preventDefault();
            openMenu();
          }
        }}
        disabled={!canOpen}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="More save options"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          padding: 0,
          background: (canOpen && (!disabled || enabledIndexes.length > 0)) ? GREEN : '#f1f5f9',
          color: (canOpen && (!disabled || enabledIndexes.length > 0)) ? '#fff' : '#94a3b8',
          border: 'none',
          // A hairline seam so the two halves read as one control.
          borderLeft: `1px solid ${(canOpen && (!disabled || enabledIndexes.length > 0)) ? 'rgba(255,255,255,0.28)' : '#e2e8f0'}`,
          borderTopRightRadius: 4,
          borderBottomRightRadius: 4,
          cursor: canOpen ? 'pointer' : 'not-allowed',
        }}
      >
        <ChevronUp
          size={15}
          style={{
            transition: 'transform 120ms ease',
            transform: open ? 'rotate(180deg)' : 'none',
          }}
        />
      </button>
    </div>
  );
}
