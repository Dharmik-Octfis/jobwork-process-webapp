import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';

/** Above `Modal`'s overlay (1100) — a portalled menu is a sibling of it. */
const PORTAL_Z_INDEX = 1200;
const MENU_MAX_HEIGHT = 300;
/** Below this much room under the anchor, the menu opens upwards instead. */
const MENU_MIN_HEIGHT = 200;

interface Option {
  label: string;
  value: string;
  disabled?: boolean;
}

interface SearchableSelectProps {
  options: Option[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  /** Overrides on the TRIGGER box itself — `style` lands on the positioning
   * container, which cannot size or colour the control the user sees. Mirrors
   * `Select`'s `buttonStyle`. */
  triggerStyle?: React.CSSProperties;
  className?: string;
  renderOption?: (option: Option, isSelected: boolean) => React.ReactNode;
  renderValue?: (option: Option) => React.ReactNode;
  footerAction?: { text: string; icon?: React.ReactNode; onClick: () => void };
  hasError?: boolean;
  dropdownWidth?: string | number;
  /**
   * 🔴 Render the menu into `document.body`, positioned `fixed`.
   *
   * Required whenever this sits inside a `Modal`: the dialog body scrolls and the
   * cards and tables inside it set `overflow` for their rounded corners and their
   * horizontal scroll, so an `absolute` menu is CLIPPED to the cell and most of it
   * cannot be reached. Off by default — a select on an ordinary page needs none of
   * it, and measuring the anchor is not free.
   */
  portal?: boolean;
}

export function SearchableSelect({
  options,
  value,
  hasError,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  style,
  triggerStyle,
  className,
  renderOption,
  renderValue,
  footerAction,
  dropdownWidth,
  portal = false,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [menuPlacement, setMenuPlacement] = useState<'bottom' | 'top'>('bottom');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const optionsContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // 🔴 The menu is checked SEPARATELY. Portalled, it is not a descendant of
      // the anchor, so testing the anchor alone closes the dropdown on the very
      // click that was choosing an option.
      if (dropdownRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /** `window` is ahead of `document` in the capture path, which is what lets this
   * stop Escape before the dialog behind it ever sees it — otherwise one Escape
   * closes the menu AND the modal. */
  useEffect(() => {
    if (!portal || !isOpen) return undefined;
    const onKeyDownCapture = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.stopImmediatePropagation();
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDownCapture, true);
    return () => window.removeEventListener('keydown', onKeyDownCapture, true);
  }, [portal, isOpen]);

  /** Re-measured on scroll in the CAPTURE phase: the scrollers are the dialog
   * body and the batch table inside it, and `scroll` does not bubble — a listener
   * on `window` never hears either and the menu hangs in mid-air. */
  useLayoutEffect(() => {
    if (!portal || !isOpen) return undefined;
    const place = () => {
      const anchor = dropdownRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width =
        typeof dropdownWidth === 'number' ? dropdownWidth : dropdownWidth ? rect.width : rect.width;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const dropUp = spaceBelow < MENU_MIN_HEIGHT && spaceAbove > spaceBelow;
      setMenuPosition({
        // Clamped to the viewport so a cell near the right edge does not push the
        // menu off-screen — the whole point of escaping the table's clipping.
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        width: dropdownWidth ?? rect.width,
        maxHeight: Math.min(MENU_MAX_HEIGHT, dropUp ? spaceAbove : spaceBelow),
        ...(dropUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [portal, isOpen, dropdownWidth]);

  useEffect(() => {
    if (isOpen && dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < 320 && rect.top > 320) {
        setMenuPlacement('top');
      } else {
        setMenuPlacement('bottom');
      }
      setSearchTerm('');
      setFocusedIndex(-1);
    }
  }, [isOpen]);

  const filteredOptions = options.filter(
    (opt) =>
      String(opt.label).toLowerCase().includes(String(searchTerm).toLowerCase()) ||
      String(opt.value).toLowerCase().includes(String(searchTerm).toLowerCase()),
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex((prev) => {
        const next = Math.min(prev + 1, filteredOptions.length - 1);
        scrollToIndex(next);
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex((prev) => {
        const next = Math.max(prev - 1, 0);
        scrollToIndex(next);
        return next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
        const opt = filteredOptions[focusedIndex];
        if (!opt.disabled) {
          onChange(opt.value);
          setIsOpen(false);
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key === 'Tab') {
      setIsOpen(false);
    }
  };

  const scrollToIndex = (index: number) => {
    if (optionsContainerRef.current) {
      const container = optionsContainerRef.current;
      const optionElements = container.children;
      if (index >= 0 && index < optionElements.length) {
        const el = optionElements[index] as HTMLElement;
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();

        if (elRect.bottom > containerRect.bottom) {
          container.scrollTop += elRect.bottom - containerRect.bottom;
        } else if (elRect.top < containerRect.top) {
          container.scrollTop -= containerRect.top - elRect.top;
        }
      }
    }
  };

  return (
    <div
      ref={dropdownRef}
      style={{
        position: 'relative',
        width: '100%',
        ...style,
        zIndex: isOpen ? 100 : (style?.zIndex ?? 'auto'),
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={triggerRef}
        className={className}
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        style={{
          padding: '8px 12px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          fontSize: 13,
          backgroundColor: disabled ? 'var(--color-bg-subtle)' : 'white',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          minHeight: '38px',
          boxShadow: isOpen
            ? '0 0 0 1px var(--color-primary)'
            : hasError
              ? '0 0 0 1px #dc2626'
              : 'none',
          borderColor: isOpen
            ? 'var(--color-primary)'
            : hasError
              ? '#dc2626'
              : 'var(--color-border)',
          outline: 'none',
          ...triggerStyle,
        }}
        onFocus={(e) => {
          if (!isOpen && !disabled) {
            e.currentTarget.style.borderColor = 'var(--color-primary)';
          }
        }}
        onBlur={(e) => {
          if (!isOpen && !disabled) {
            e.currentTarget.style.borderColor = 'var(--color-border)';
          }
        }}
      >
        <span
          style={{
            color: selectedOption ? 'inherit' : 'var(--color-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {selectedOption
            ? renderValue
              ? renderValue(selectedOption)
              : selectedOption.label
            : placeholder}
        </span>
        {isOpen ? (
          <ChevronUp size={16} color="var(--color-text-muted)" />
        ) : (
          <ChevronDown size={16} color="var(--color-text-muted)" />
        )}
      </div>

      {isOpen &&
        renderInPortal(
          portal,
          <div
            ref={portal ? menuRef : undefined}
            /* Portalled, the menu is outside the wrapper that carries the arrow /
               Enter / Escape handling, so it needs its own copy — a keystroke in
               the search box would otherwise reach nothing. */
            onKeyDown={portal ? handleKeyDown : undefined}
            style={
              portal
                ? { position: 'fixed', zIndex: PORTAL_Z_INDEX, ...menuPosition }
                : dropdownWidth
                  ? {
                      position: 'absolute',
                      ...(menuPlacement === 'top' ? { bottom: '100%' } : { top: '100%' }),
                      left: 0,
                      width: 0,
                      height: 0,
                    }
                  : {
                      position: 'absolute',
                      ...(menuPlacement === 'top' ? { bottom: '100%' } : { top: '100%' }),
                      left: 0,
                      right: 0,
                    }
            }
          >
            <div
              style={{
                ...(portal
                  ? { width: '100%', maxHeight: 'inherit' }
                  : dropdownWidth
                    ? {
                        position: 'absolute',
                        ...(menuPlacement === 'top'
                          ? { bottom: 0, marginBottom: 4 }
                          : { top: 0, marginTop: 4 }),
                        left: 0,
                        width: dropdownWidth,
                      }
                    : {
                        ...(menuPlacement === 'top' ? { marginBottom: 4 } : { marginTop: 4 }),
                        width: '100%',
                      }),
                backgroundColor: 'white',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
                zIndex: 1000,
                maxHeight: portal ? undefined : 300,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: 8, borderBottom: '1px solid var(--color-border)' }}>
                <div style={{ position: 'relative' }}>
                  <Search
                    size={14}
                    color="#9CA3AF"
                    style={{
                      position: 'absolute',
                      left: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                    }}
                  />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search"
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setFocusedIndex(-1);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: '100%',
                      padding: '6px 8px 6px 28px',
                      borderRadius: '4px',
                      border: '1px solid var(--color-border)',
                      fontSize: 13,
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                    onFocus={(e) => (e.target.style.borderColor = 'var(--color-primary)')}
                    onBlur={(e) => (e.target.style.borderColor = 'var(--color-border)')}
                    autoFocus
                  />
                </div>
              </div>
              <div
                ref={optionsContainerRef}
                style={{
                  overflowY: 'auto',
                  flex: 1,
                  padding: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                {filteredOptions.length > 0 ? (
                  filteredOptions.map((opt, idx) => (
                    <div
                      key={`${opt.value}-${idx}`}
                      onClick={() => {
                        if (opt.disabled) return;
                        onChange(opt.value);
                        setIsOpen(false);
                        setSearchTerm('');
                      }}
                      style={{
                        padding: '8px 12px',
                        cursor: opt.disabled ? 'not-allowed' : 'pointer',
                        fontSize: 13,
                        borderRadius: '4px',
                        backgroundColor:
                          opt.value === value
                            ? 'var(--color-primary)'
                            : focusedIndex === idx
                              ? '#EFF6FF'
                              : 'transparent',
                        color: opt.disabled
                          ? 'var(--color-text-muted)'
                          : opt.value === value
                            ? 'white'
                            : 'inherit',
                        opacity: opt.disabled ? 0.6 : 1,
                      }}
                      onMouseEnter={(e) => {
                        if (opt.value !== value && !opt.disabled) {
                          e.currentTarget.style.backgroundColor = '#EFF6FF';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (opt.value !== value && !opt.disabled) {
                          if (focusedIndex !== idx) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }
                        }
                      }}
                    >
                      {renderOption ? renderOption(opt, opt.value === value) : opt.label}
                    </div>
                  ))
                ) : (
                  <div
                    style={{
                      padding: '8px 12px',
                      fontSize: 13,
                      color: 'var(--color-text-muted)',
                      textAlign: 'center',
                    }}
                  >
                    No results found
                  </div>
                )}
              </div>
              {footerAction && (
                <div
                  onClick={() => {
                    setIsOpen(false);
                    footerAction.onClick();
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f9fafb';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'white';
                  }}
                  style={{
                    backgroundColor: 'white',
                    borderTop: '1px solid var(--color-border)',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    color: '#3b82f6',
                    fontSize: 13,
                    fontWeight: 500,
                    borderBottomLeftRadius: 'var(--radius-md)',
                    borderBottomRightRadius: 'var(--radius-md)',
                  }}
                >
                  {footerAction.icon}
                  {footerAction.text}
                </div>
              )}
            </div>
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
