import { Check, Archive, X, Loader2 } from 'lucide-react';
import { useCombobox } from 'downshift';
import { useState, useMemo, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { itemsApi } from '../../features/items/items.api';
import type { Item } from '../../features/items/items.schemas';

/** Above `Modal`'s overlay (1100) — a portalled menu is a sibling of it. */
const PORTAL_Z_INDEX = 1200;
const MENU_MAX_HEIGHT = 260;
/** Below this much room under the anchor, the menu opens upwards instead. */
const MENU_MIN_HEIGHT = 160;

interface ItemComboBoxProps {
  orgId: string;
  value?: string | null;
  initialItem?: Item | null;
  onChange: (item: Item | null) => void;
  placeholder?: string;
  excludeItemId?: string;
  hasError?: boolean;
  disabled?: boolean;
  /** The control has no `<label>` of its own on a grid — without this a screen
   * reader announces it as "edit text" and nothing more. */
  ariaLabel?: string;
  style?: React.CSSProperties;
  onBlur?: () => void;
  name?: string;
  selectedImage?: React.ReactNode;
  onOpenMultiSelect?: () => void;
  footerAction?: {
    text: string;
    onClick: () => void;
  };
  filter?: string;
  /**
   * 🔴 REQUIRED WHENEVER THIS SITS INSIDE A `Modal` (CLAUDE.md) — same prop, same
   * reason, and the same implementation as `ui/Select.tsx`'s. The dialog body is
   * an `overflow-y: auto` scroll container, so the default `position: absolute`
   * menu is clipped by it on both axes and most of the list is unreachable.
   */
  portal?: boolean;
}

export function ItemComboBox({
  orgId,
  value,
  initialItem,
  onChange,
  placeholder,
  excludeItemId,
  hasError,
  disabled = false,
  ariaLabel,
  style,
  onBlur,
  name,
  selectedImage,
  onOpenMultiSelect,
  footerAction,
  filter,
  portal = false,
}: ItemComboBoxProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });
  /** Downshift's own id rather than a ref: Escape has to put focus back on the
   * input programmatically, and reading a ref through a prop getter during
   * render is what `react-hooks/refs` forbids. */
  const inputId = `${useId()}-item-combobox`;

  const [inputValue, setInputValue] = useState(() => {
    if (initialItem && initialItem.id === value) return initialItem.name;
    return '';
  });
  const [debouncedValue, setDebouncedValue] = useState(inputValue);
  const isInternalChange = useRef(false);
  const [isInteracted, setIsInteracted] = useState(false);

  const handleOnChange = (newVal: Item | null) => {
    isInternalChange.current = true;
    onChange(newVal);
  };

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(inputValue.length >= 3 ? inputValue : '');
    }, 300);
    return () => clearTimeout(handler);
  }, [inputValue]);

  const {
    data: itemsData,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['items-search', orgId, debouncedValue, filter],
    queryFn: ({ pageParam }) =>
      itemsApi.getItems(orgId, {
        search: debouncedValue || undefined,
        perPage: 10,
        page: pageParam,
        filter,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pageContext.hasMore ? lastPage.pageContext.page + 1 : undefined,
    enabled: Boolean(orgId) && isInteracted,
    refetchOnWindowFocus: false,
  });

  const fetchedOptions = useMemo(() => {
    let options = itemsData?.pages.flatMap((page) => page.results) || [];
    if (excludeItemId) {
      options = options.filter((opt) => opt.id !== excludeItemId);
    }
    return options;
  }, [itemsData, excludeItemId]);

  const selectedItem = useMemo(() => {
    if (!value) return null;
    const found = fetchedOptions.find((opt) => opt.id === value);
    if (found) return found;
    if (initialItem && initialItem.id === value) return initialItem;
    return null;
  }, [fetchedOptions, value, initialItem]);

  useEffect(() => {
    if (!isInternalChange.current) {
      setInputValue(selectedItem ? selectedItem.name : '');
    } else {
      isInternalChange.current = false;
    }
  }, [selectedItem]);

  const {
    isOpen,
    getMenuProps,
    getInputProps,
    highlightedIndex,
    getItemProps,
    openMenu,
    closeMenu,
  } = useCombobox({
    inputId,
    stateReducer: (_state, actionAndChanges) => {
      const { type, changes } = actionAndChanges;
      switch (type) {
        case useCombobox.stateChangeTypes.InputClick:
          return {
            ...changes,
            isOpen: true,
          };
        default:
          return changes;
      }
    },
    items: fetchedOptions,
    itemToString: (item) => (item ? item.name : ''),
    selectedItem,
    inputValue,
    onInputValueChange: ({ inputValue: newInputValue, type }) => {
      setInputValue(newInputValue || '');
      if (type === useCombobox.stateChangeTypes.InputChange) {
        if (selectedItem && newInputValue !== selectedItem.name) {
          handleOnChange(null);
        } else if (!newInputValue) {
          handleOnChange(null);
        }
      }
    },
    onSelectedItemChange: ({ selectedItem: newSelectedItem }) => {
      handleOnChange(newSelectedItem || null);
      if (newSelectedItem) {
        setInputValue(newSelectedItem.name);
      }
    },
  });

  /** `window` is ahead of `document` in the capture path, which is what lets this
   * stop Escape before the dialog behind it ever sees it — otherwise one Escape
   * over an open list closes the whole dialog. */
  useEffect(() => {
    if (!portal || !isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeMenu();
      document.getElementById(inputId)?.focus();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [portal, isOpen, closeMenu, inputId]);

  /** Re-measured on scroll in the CAPTURE phase: the scrollers are the dialog
   * body and any grid inside it, and `scroll` does not bubble — a listener on
   * `window` never hears either and the menu hangs in mid-air. */
  useLayoutEffect(() => {
    if (!portal || !isOpen) return undefined;
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(rect.width, window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      // Flip up only when below is genuinely too tight AND above is roomier —
      // otherwise a menu near the bottom of a tall dialog flaps between the two.
      const openUp = below < MENU_MIN_HEIGHT && above > below;
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
  }, [portal, isOpen]);

  return (
    <div ref={anchorRef} style={{ position: 'relative', width: '100%', ...style }}>
      <div style={{ position: 'relative', width: '100%' }}>
        <input
          {...getInputProps({
            name,
            placeholder,
            disabled,
            'aria-label': ariaLabel,
            onBlur: () => {
              if (onBlur) onBlur();
            },
            onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
              e.target.style.borderColor = 'var(--color-primary)';
              // Select all text on focus for easy typing
              e.target.select();
              setIsInteracted(true);
              if (!isOpen) {
                openMenu();
              }
            },
            onClick: () => {
              setIsInteracted(true);
              if (!isOpen) {
                openMenu();
              }
            },
            style: {
              width: '100%',
              // Right padding reserves the icon strip — two slots where the bulk
              // picker's box icon is drawn, one where only the clear/spinner is.
              padding: `6px ${onOpenMultiSelect ? '48px' : '28px'} 6px ${selectedImage ? '36px' : '8px'}`,
              fontSize: '13px',
              border: `1px solid ${hasError ? 'var(--color-danger, #ef4444)' : 'var(--color-border, #d1d5db)'}`,
              borderRadius: '4px',
              boxSizing: 'border-box',
              outline: 'none',
              background: disabled ? 'var(--color-bg, #f4f5f7)' : '#fff',
              cursor: disabled ? 'not-allowed' : 'text',
            },
          })}
          onBlurCapture={(e: React.FocusEvent<HTMLInputElement>) => {
            e.target.style.borderColor = hasError
              ? 'var(--color-danger, #ef4444)'
              : 'var(--color-border, #d1d5db)';
          }}
        />
        {selectedImage && (
          <div
            style={{
              position: 'absolute',
              left: '8px',
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '20px',
              height: '20px',
              borderRadius: '4px',
              overflow: 'hidden',
            }}
          >
            {selectedImage}
          </div>
        )}
        <style>
          {`
            @keyframes combobox-spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          `}
        </style>
        <div
          style={{
            position: 'absolute',
            right: '4px',
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
          }}
        >
          {isFetching && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4px',
              }}
            >
              <Loader2
                size={14}
                color="#9ca3af"
                style={{ animation: 'combobox-spin 1s linear infinite' }}
              />
            </div>
          )}
          {selectedItem && !disabled && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                handleOnChange(null);
                setInputValue('');
              }}
              style={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '2px',
                borderRadius: '50%',
                background: '#e2e8f0',
              }}
            >
              <X size={12} color="#475569" />
            </div>
          )}
          {/* The box icon OPENS THE BULK PICKER, and that is the only reason it is
              here. As a plain menu toggle it was decoration — clicking or focusing
              the input already opens the list — so it is drawn only where there is
              a bulk picker behind it (bills, purchase orders, composite items).
              The steps grid passes no `onOpenMultiSelect` and gets a clean box. */}
          {onOpenMultiSelect && (
            <div
              onClick={(e) => {
                if (disabled) return;
                e.preventDefault();
                e.stopPropagation();
                onOpenMultiSelect();
              }}
              style={{
                cursor: disabled ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-text-muted, #9ca3af)',
                padding: '4px',
              }}
            >
              <Archive size={14} color="#333" />
            </div>
          )}
        </div>
      </div>

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
                  top: 'calc(100% + 4px)',
                  left: 0,
                  right: 0,
                  zIndex: 1000,
                  maxHeight: MENU_MAX_HEIGHT,
                }),
            backgroundColor: '#fff',
            border: isOpen && !disabled ? '1px solid var(--color-border, #e5e7eb)' : 'none',
            borderRadius: '4px',
            boxShadow:
              isOpen && !disabled
                ? '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
                : 'none',
            display: isOpen && !disabled ? 'flex' : 'none',
            flexDirection: 'column',
          }}
        >
          <div
            style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}
            onScroll={(e) => {
              const target = e.currentTarget;
              if (target.scrollHeight - target.scrollTop <= target.clientHeight + 10) {
                if (hasNextPage && !isFetchingNextPage) {
                  fetchNextPage();
                }
              }
            }}
          >
            {isOpen && fetchedOptions.length === 0 && (
              <div
                style={{ padding: '8px 12px', fontSize: '13px', color: 'var(--color-text-muted)' }}
              >
                No matching items.
              </div>
            )}
            {isOpen &&
              fetchedOptions.map((opt, index) => (
                <div
                  {...getItemProps({ item: opt, index })}
                  key={opt.id}
                  style={{
                    padding: '8px 12px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor:
                      highlightedIndex === index
                        ? 'var(--color-surface-2, #f3f4f6)'
                        : selectedItem?.id === opt.id
                          ? 'var(--color-primary-soft)'
                          : 'transparent',
                    color: 'var(--color-text)',
                  }}
                >
                  <span
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {opt.name} {opt.sku ? `(${opt.sku})` : ''}
                  </span>
                  {selectedItem?.id === opt.id && <Check size={14} color="var(--color-primary)" />}
                </div>
              ))}
          </div>

          {/* Footer Action */}
          {isOpen && footerAction && (
            <div
              onClick={(e) => {
                e.preventDefault();
                footerAction.onClick();
              }}
              style={{
                padding: '10px 12px',
                fontSize: '13px',
                color: '#3b82f6', // primary blue
                borderTop: '1px solid var(--color-border, #e5e7eb)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor: '#fff',
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = 'var(--color-surface-2, #f3f4f6)')
              }
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#fff')}
            >
              {footerAction.text}
            </div>
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
