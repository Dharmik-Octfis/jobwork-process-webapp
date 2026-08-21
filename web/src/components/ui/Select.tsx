import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { useSelect } from 'downshift';

export interface SelectOption {
  value: string;
  label: string;
}

/** Above `Modal`'s overlay (1100) — a portalled menu is a sibling of it. */
const PORTAL_Z_INDEX = 1200;
const MENU_MAX_HEIGHT = 260;
/** Below this much room under the anchor, the menu opens upwards instead. */
const MENU_MIN_HEIGHT = 160;

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled = false,
  hasError = false,
  minWidth = 140,
  fullWidth = true,
  dropUp = false,
  ariaLabel,
  containerStyle,
  buttonStyle,
  actionItem,
  menuWidth,
  portal = false,
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
  menuWidth?: number | string;
  /**
   * 🔴 REQUIRED WHENEVER THIS SITS INSIDE A `Modal` (CLAUDE.md).
   *
   * The dialog body is an `overflow-y: auto` scroll container, and CSS computes
   * `overflow-x` to `auto` alongside it — so the default `position: absolute`
   * menu is clipped on BOTH axes by the dialog. A dropdown in the last column of
   * a grid opens mostly outside it and is unreachable; one on the last row opens
   * below the fold. Neither `tsc -b` nor a screenshot of the closed control says
   * a word.
   *
   * Portalled, the menu is a fixed-position sibling of the overlay: it escapes
   * every clip, flips up when the room below runs out, and takes Escape back off
   * the dialog (which listens on `document` in the capture phase, so without this
   * one Escape over an open list closes the whole dialog).
   *
   * Off by default — a `Select` on an ordinary page needs none of it, and
   * measuring the anchor is not free.
   */
  portal?: boolean;
}) {
  const selected = options.find((o) => o.value === value);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });

  /** Downshift's own id rather than a ref of ours: the toggle has to be focused
   * programmatically when Escape closes the menu, and reading a ref through a
   * prop getter during render is what `react-hooks/refs` forbids. */
  const toggleButtonId = `${useId()}-select-toggle`;

  const { isOpen, getToggleButtonProps, getMenuProps, highlightedIndex, getItemProps, closeMenu } =
    useSelect({
      items: options,
      toggleButtonId,
      selectedItem: selected || null,
      itemToString: (item) => (item ? item.label : ''),
      onSelectedItemChange: ({ selectedItem }) => {
        if (selectedItem) {
          onChange(selectedItem.value);
        }
      },
    });

  /** `window` is ahead of `document` in the capture path, which is what lets this
   * stop Escape before the dialog behind it ever sees it. */
  useEffect(() => {
    if (!portal || !isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeMenu();
      document.getElementById(toggleButtonId)?.focus();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [portal, isOpen, closeMenu, toggleButtonId]);

  /** Re-measured on scroll in the CAPTURE phase: the scrollers are the dialog
   * body and any grid inside it, and `scroll` does not bubble — a listener on
   * `window` never hears either and the menu hangs in mid-air. */
  useLayoutEffect(() => {
    if (!portal || !isOpen) return undefined;
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(
        Math.max(rect.width, typeof menuWidth === 'number' ? menuWidth : rect.width),
        window.innerWidth - 16,
      );
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      // Flip up only when below is genuinely too tight AND above is roomier —
      // otherwise a menu near the bottom of a tall dialog flaps between the two.
      const openUp = dropUp || (below < MENU_MIN_HEIGHT && above > below);
      setMenuPosition({
        left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8)),
        width,
        maxHeight: Math.min(MENU_MAX_HEIGHT, Math.max(openUp ? above : below, MENU_MIN_HEIGHT)),
        ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [portal, isOpen, dropUp, menuWidth]);

  return (
    <div
      ref={anchorRef}
      style={{
        position: 'relative',
        minWidth,
        width: fullWidth ? '100%' : minWidth,
        ...containerStyle,
      }}
    >
      <button
        type="button"
        {...getToggleButtonProps({
          disabled,
          'aria-label': ariaLabel,
          style: {
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
          },
        })}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={14}
          color="var(--color-text-muted)"
          style={{
            flexShrink: 0,
            transform: isOpen ? 'rotate(180deg)' : undefined,
            transition: 'transform 0.15s',
          }}
        />
      </button>

      {/* 🔴 Kept mounted while closed in BOTH modes — downshift needs
          `getMenuProps`' ref on a live element to tell a click inside its own
          menu from one outside it. */}
      {renderInPortal(
        portal,
        <div
          {...getMenuProps()}
          style={{
            ...(portal
              ? { position: 'fixed', zIndex: PORTAL_Z_INDEX, ...menuPosition }
              : {
                  position: 'absolute',
                  ...(dropUp ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
                  left: 0,
                  minWidth: menuWidth ?? '100%',
                  width: menuWidth ? menuWidth : 'max-content',
                  maxWidth: menuWidth ?? 400,
                  zIndex: 70,
                  maxHeight: MENU_MAX_HEIGHT,
                }),
            background: 'var(--color-surface)',
            border: isOpen && !disabled ? '1px solid var(--color-border)' : 'none',
            borderRadius: 'var(--radius-md)',
            boxShadow: isOpen && !disabled ? 'var(--shadow-md)' : 'none',
            overflow: 'hidden auto',
            display: isOpen && !disabled ? 'flex' : 'none',
            flexDirection: 'column',
          }}
        >
          {isOpen && !disabled && (
            <>
              <div style={{ overflow: 'hidden auto' }}>
                {options.length === 0 ? (
                  <div
                    style={{
                      padding: '10px 12px',
                      fontSize: 13,
                      color: 'var(--color-text-subtle)',
                    }}
                  >
                    No options
                  </div>
                ) : (
                  options.map((opt, index) => {
                    const isSelected = opt.value === value;
                    return (
                      <div
                        {...getItemProps({ item: opt, index })}
                        key={opt.value}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                          width: '100%',
                          textAlign: 'left',
                          padding: '8px 12px',
                          border: 'none',
                          background:
                            highlightedIndex === index
                              ? 'var(--color-surface-2)'
                              : isSelected
                                ? 'var(--color-primary-soft)'
                                : 'transparent',
                          fontFamily: 'var(--font-sans)',
                          fontSize: 13,
                          color: 'var(--color-text)',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {opt.label}
                        {isSelected && <Check size={14} color="var(--color-primary)" />}
                      </div>
                    );
                  })
                )}
              </div>
              {actionItem && (
                <div style={{ borderTop: '1px solid var(--color-border)', padding: '4px' }}>
                  {actionItem}
                </div>
              )}
            </>
          )}
        </div>,
      )}
    </div>
  );
}

/** One call site, two homes: `document.body` when the menu has to escape a
 * dialog's clipping, the anchor itself otherwise. */
function renderInPortal(portal: boolean, menu: React.ReactElement) {
  return portal ? createPortal(menu, document.body) : menu;
}
