import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, ChevronUp, X as XIcon, Loader2 } from 'lucide-react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { itemsApi } from '../../features/items/items.api';
import type { Item } from '../../features/items/items.schemas';

const PORTAL_Z_INDEX = 1200;
const MENU_MAX_HEIGHT = 300;
const MENU_MIN_HEIGHT = 200;

interface ItemSearchableSelectProps {
  orgId: string;
  value?: string | null;
  initialItem?: Item | null;
  onChange: (item: Item | null) => void;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  triggerStyle?: React.CSSProperties;
  className?: string;
  dropdownWidth?: string | number;
  portal?: boolean;
  filter?: string;
  renderValue?: (item: Item | null) => React.ReactNode;
}

export function ItemSearchableSelect({
  orgId,
  value,
  initialItem,
  onChange,
  placeholder = 'Select Item...',
  disabled = false,
  style,
  triggerStyle,
  className,
  dropdownWidth,
  portal = false,
  filter,
  renderValue,
}: ItemSearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [menuPlacement, setMenuPlacement] = useState<'bottom' | 'top'>('bottom');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const [isInteracted, setIsInteracted] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const optionsContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  const {
    data: itemsData,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['items-search', orgId, debouncedSearch, filter],
    queryFn: ({ pageParam }) =>
      itemsApi.getItems(orgId, {
        search: debouncedSearch || undefined,
        perPage: 15,
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
    return itemsData?.pages.flatMap((page) => page.results) || [];
  }, [itemsData]);

  const selectedItem = useMemo(() => {
    if (!value) return null;
    const found = fetchedOptions.find((opt) => opt.id === value);
    if (found) return found;
    if (initialItem && initialItem.id === value) return initialItem;
    return null;
  }, [fetchedOptions, value, initialItem]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  useLayoutEffect(() => {
    if (!portal || !isOpen) return undefined;
    const place = () => {
      const anchor = dropdownRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = typeof dropdownWidth === 'number' ? dropdownWidth : dropdownWidth ? rect.width : rect.width;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const dropUp = spaceBelow < MENU_MIN_HEIGHT && spaceAbove > spaceBelow;
      setMenuPosition({
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
      setIsInteracted(true);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
    }
  }, [isOpen]);

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
        const next = Math.min(prev + 1, fetchedOptions.length - 1);
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
      if (focusedIndex >= 0 && focusedIndex < fetchedOptions.length) {
        const opt = fetchedOptions[focusedIndex];
        onChange(opt);
        setIsOpen(false);
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

  const renderOption = (opt: Item, _isSelected: boolean) => (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontWeight: 500, color: '#111827' }}>{opt.name}</span>
      {opt.sku && <span style={{ fontSize: '12px', color: '#6b7280' }}>SKU: {opt.sku}</span>}
    </div>
  );

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
          boxShadow: isOpen ? '0 0 0 1px var(--color-primary)' : 'none',
          borderColor: isOpen ? 'var(--color-primary)' : 'var(--color-border)',
          outline: 'none',
          ...triggerStyle,
        }}
      >
        <span
          style={{
            color: 'inherit',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {renderValue ? renderValue(selectedItem) : (selectedItem ? selectedItem.name : placeholder)}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {selectedItem && !disabled && (
            <>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  padding: '2px',
                  borderRadius: '50%',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f3f4f6')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <XIcon size={14} color="#ef4444" />
              </div>
              <div style={{ width: '1px', height: '14px', backgroundColor: '#e5e7eb' }} />
            </>
          )}
          {isOpen ? (
            <ChevronUp size={16} color="var(--color-text-muted)" />
          ) : (
            <ChevronDown size={16} color="var(--color-text-muted)" />
          )}
        </div>
      </div>

      {isOpen &&
        renderInPortal(
          portal,
          <div
            ref={portal ? menuRef : undefined}
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
                        ...(menuPlacement === 'top' ? { bottom: 0, marginBottom: 4 } : { top: 0, marginTop: 4 }),
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
                    className="no-global-focus"
                    type="text"
                    placeholder="Search Items..."
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
                onScroll={(e) => {
                  const target = e.currentTarget;
                  if (target.scrollHeight - target.scrollTop <= target.clientHeight + 10) {
                    if (hasNextPage && !isFetchingNextPage) {
                      fetchNextPage();
                    }
                  }
                }}
              >
                {isFetching && !isFetchingNextPage && fetchedOptions.length === 0 ? (
                  <div style={{ padding: '20px', display: 'flex', justifyContent: 'center' }}>
                    <Loader2 size={16} color="#9ca3af" style={{ animation: 'spin 1s linear infinite' }} />
                  </div>
                ) : fetchedOptions.length > 0 ? (
                  fetchedOptions.map((opt, idx) => (
                    <div
                      key={opt.id}
                      onClick={() => {
                        onChange(opt);
                        setIsOpen(false);
                      }}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: 13,
                        borderRadius: '4px',
                        backgroundColor:
                          opt.id === value
                            ? '#EFF6FF'
                            : focusedIndex === idx
                              ? '#F3F4F6'
                              : 'transparent',
                        color: opt.id === value ? '#1d4ed8' : 'inherit',
                      }}
                      onMouseEnter={(e) => {
                        if (opt.id !== value) {
                          e.currentTarget.style.backgroundColor = '#F3F4F6';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (opt.id !== value) {
                          if (focusedIndex !== idx) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }
                        }
                      }}
                    >
                      {renderOption(opt, opt.id === value)}
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
                    No items found
                  </div>
                )}
                {isFetchingNextPage && (
                  <div style={{ padding: '8px', display: 'flex', justifyContent: 'center' }}>
                    <Loader2 size={14} color="#9ca3af" style={{ animation: 'spin 1s linear infinite' }} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

function renderInPortal(portal: boolean, menu: React.ReactElement) {
  return portal ? createPortal(menu, document.body) : menu;
}
