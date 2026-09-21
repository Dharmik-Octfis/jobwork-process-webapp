import { Check, Loader2, X } from 'lucide-react';
import { useCombobox } from 'downshift';
import { useState, useMemo, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchJobOrders, fetchJobOrderById } from './jobOrders.api';
import type { JobOrder } from './jobOrders.schemas';

const PORTAL_Z_INDEX = 1200;
const MENU_MAX_HEIGHT = 260;
const MENU_MIN_HEIGHT = 160;

interface JobOrderComboBoxProps {
  orgId: string;
  value?: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  hasError?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  style?: React.CSSProperties;
  onBlur?: () => void;
  name?: string;
  portal?: boolean;
  initialJobOrder?: JobOrder | null;
  filter?: string;
}

export function JobOrderComboBox({
  orgId,
  value,
  onChange,
  placeholder = 'Select Job Order...',
  hasError,
  disabled = false,
  ariaLabel,
  style,
  onBlur,
  name,
  portal = false,
  initialJobOrder,
  filter = 'all_orders',
}: JobOrderComboBoxProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const inputId = `${useId()}-joborder-combobox`;

  const [inputValue, setInputValue] = useState('');
  const [debouncedValue, setDebouncedValue] = useState(inputValue);
  const isInternalChange = useRef(false);
  const [isInteracted, setIsInteracted] = useState(false);
  const [selectedJobOrder, setSelectedJobOrder] = useState<JobOrder | null>(initialJobOrder || null);

  const handleOnChange = (newVal: JobOrder | null) => {
    isInternalChange.current = true;
    setSelectedJobOrder(newVal);
    onChange(newVal ? newVal.id : null);
  };

  useEffect(() => {
    const handler = setTimeout(() => {
      const isMatchingSelected =
        selectedJobOrder &&
        inputValue ===
          `${selectedJobOrder.jobOrderNumber} - ${selectedJobOrder.inputItem?.name ?? 'No item'}`;

      if (isMatchingSelected) {
        setDebouncedValue(''); // Clear search if it's just the selected label
      } else {
        setDebouncedValue(inputValue.length >= 3 ? inputValue : '');
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [inputValue, selectedJobOrder]);

  const {
    data: jobOrdersData,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['job-orders-search', orgId, debouncedValue, filter],
    queryFn: ({ pageParam }) =>
      fetchJobOrders(orgId, {
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
    return jobOrdersData?.pages.flatMap((page) => page.results) || [];
  }, [jobOrdersData]);

  const { data: initialJobOrderQuery } = useQuery({
    queryKey: ['job-order', orgId, value, 'light'],
    queryFn: () => fetchJobOrderById(orgId, value!, true),
    enabled: Boolean(value && selectedJobOrder?.id !== value && !fetchedOptions.find(o => o.id === value)),
    staleTime: Infinity,
  });

  const [prevValue, setPrevValue] = useState(value);
  const [prevFetchedOptions, setPrevFetchedOptions] = useState(fetchedOptions);
  const [prevInitialJobOrder, setPrevInitialJobOrder] = useState(initialJobOrder);
  const [prevInitialJobOrderQuery, setPrevInitialJobOrderQuery] = useState(initialJobOrderQuery);

  if (
    value !== prevValue ||
    fetchedOptions !== prevFetchedOptions ||
    initialJobOrder !== prevInitialJobOrder ||
    initialJobOrderQuery !== prevInitialJobOrderQuery
  ) {
    setPrevValue(value);
    setPrevFetchedOptions(fetchedOptions);
    setPrevInitialJobOrder(initialJobOrder);
    setPrevInitialJobOrderQuery(initialJobOrderQuery);

    if (!value) {
      if (selectedJobOrder !== null) {
        setSelectedJobOrder(null);
      }
    } else {
      const found = fetchedOptions.find((opt) => opt.id === value);
      if (found) {
        if (selectedJobOrder?.id !== found.id) {
          setSelectedJobOrder(found);
        }
      } else if (initialJobOrder && initialJobOrder.id === value) {
        if (selectedJobOrder?.id !== initialJobOrder.id) {
          setSelectedJobOrder(initialJobOrder);
        }
      } else if (initialJobOrderQuery && initialJobOrderQuery.id === value) {
        if (selectedJobOrder?.id !== initialJobOrderQuery.id) {
          setSelectedJobOrder(initialJobOrderQuery);
        }
      }
    }
  }

  useEffect(() => {
    if (!isInternalChange.current) {
      setInputValue(
        selectedJobOrder
          ? `${selectedJobOrder.jobOrderNumber} - ${selectedJobOrder.inputItem?.name ?? 'No item'}`
          : ''
      );
    } else {
      isInternalChange.current = false;
    }
  }, [selectedJobOrder]);

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
    itemToString: (item) => (item ? `${item.jobOrderNumber} - ${item.inputItem?.name ?? 'No item'}` : ''),
    selectedItem: selectedJobOrder,
    inputValue,
    onInputValueChange: ({ inputValue: newInputValue, type }) => {
      setInputValue(newInputValue || '');
      if (type === useCombobox.stateChangeTypes.InputChange) {
        if (selectedJobOrder && newInputValue !== `${selectedJobOrder.jobOrderNumber} - ${selectedJobOrder.inputItem?.name ?? 'No item'}`) {
          handleOnChange(null);
        } else if (!newInputValue) {
          handleOnChange(null);
        }
      }
    },
    onSelectedItemChange: ({ selectedItem: newSelectedItem }) => {
      handleOnChange(newSelectedItem || null);
      if (newSelectedItem) {
        setInputValue(`${newSelectedItem.jobOrderNumber} - ${newSelectedItem.inputItem?.name ?? 'No item'}`);
      }
    },
  });

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

  useLayoutEffect(() => {
    if (!portal || !isOpen) return undefined;
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(rect.width, window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
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
              padding: '8px 28px 8px 12px',
              fontSize: '14px',
              minHeight: '38px',
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
          {selectedJobOrder && !disabled && (
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
        </div>
      </div>

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
                No matching Job Orders.
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
                        : selectedJobOrder?.id === opt.id
                          ? 'var(--color-primary-soft)'
                          : 'transparent',
                    color: 'var(--color-text)',
                  }}
                >
                  <span
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {opt.jobOrderNumber} - {opt.inputItem?.name ?? 'No item'}
                  </span>
                  {selectedJobOrder?.id === opt.id && <Check size={14} color="var(--color-primary)" />}
                </div>
              ))}
          </div>
        </div>,
      )}
    </div>
  );
}

function renderInPortal(portal: boolean, menu: React.ReactElement) {
  return portal ? createPortal(menu, document.body) : menu;
}
