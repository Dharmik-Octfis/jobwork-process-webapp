import { Check, Archive, X, Loader2, } from 'lucide-react';
import { useCombobox } from 'downshift';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { itemsApi } from '../../features/items/items.api';
import type { Item } from '../../features/items/items.schemas';

interface ItemComboBoxProps {
  orgId: string;
  value?: string | null;
  initialItem?: Item | null;
  onChange: (item: Item | null) => void;
  placeholder?: string;
  hasError?: boolean;
  style?: React.CSSProperties;
  onBlur?: () => void;
  name?: string;
  selectedImage?: React.ReactNode;
  onOpenMultiSelect?: () => void;
  footerAction?: {
    text: string;
    onClick: () => void;
  };
}

export function ItemComboBox({
  orgId,
  value,
  initialItem,
  onChange,
  placeholder,
  hasError,
  style,
  onBlur,
  name,
  selectedImage,
  onOpenMultiSelect,
  footerAction,
}: ItemComboBoxProps) {
  const [inputValue, setInputValue] = useState('');
  const [debouncedValue, setDebouncedValue] = useState('');
  const prevValueRef = useRef(value);
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
    queryKey: ['items-search', orgId, debouncedValue],
    queryFn: ({ pageParam }) => itemsApi.getItems(orgId, { search: debouncedValue || undefined, perPage: 10, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.pageContext.hasMore ? lastPage.pageContext.page + 1 : undefined,
    enabled: Boolean(orgId) && isInteracted,
    refetchOnWindowFocus: false,
  });

  const fetchedOptions = useMemo(() => {
    return itemsData?.pages.flatMap(page => page.results) || [];
  }, [itemsData]);

  const selectedItem = useMemo(() => {
    if (!value) return null;
    const found = fetchedOptions.find((opt) => opt.id === value);
    if (found) return found;
    if (initialItem && initialItem.id === value) return initialItem;
    return null;
  }, [fetchedOptions, value, initialItem]);

  useEffect(() => {
    if (value !== prevValueRef.current) {
      prevValueRef.current = value;
      if (!isInternalChange.current) {
        setInputValue(selectedItem ? selectedItem.name : '');
      }
      isInternalChange.current = false;
    }
  }, [value, selectedItem]);

  const {
    isOpen,
    getToggleButtonProps,
    getMenuProps,
    getInputProps,
    highlightedIndex,
    getItemProps,
    openMenu,
  } = useCombobox({
    stateReducer: (state, actionAndChanges) => {
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

  return (
    <div style={{ position: 'relative', width: '100%', ...style }}>
      <div style={{ position: 'relative', width: '100%' }}>
        <input
          {...getInputProps({
            name,
            placeholder,
            onBlur: () => {
              // Reset input value to selected item name on blur if not matched
              if (selectedItem) {
                setInputValue(selectedItem.name);
              } else {
                setInputValue('');
              }
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
              padding: `6px 48px 6px ${selectedImage ? '36px' : '8px'}`,
              fontSize: '13px',
              border: `1px solid ${hasError ? 'var(--color-danger, #ef4444)' : 'var(--color-border, #d1d5db)'}`,
              borderRadius: '4px',
              boxSizing: 'border-box',
              outline: 'none',
              background: '#fff',
            },
          })}
          onBlurCapture={(e: React.FocusEvent<HTMLInputElement>) => {
            e.target.style.borderColor = hasError ? 'var(--color-danger, #ef4444)' : 'var(--color-border, #d1d5db)';
          }}
        />
        {selectedImage && (
          <div style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: '4px', overflow: 'hidden' }}>
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
        <div style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: '2px' }}>
          {isFetching && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px' }}>
              <Loader2 size={14} color="#9ca3af" style={{ animation: 'combobox-spin 1s linear infinite' }} />
            </div>
          )}
          {selectedItem && (
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
          <div
            {...(onOpenMultiSelect ? {} : getToggleButtonProps())}
            onClick={(e) => {
              if (onOpenMultiSelect) {
                e.preventDefault();
                e.stopPropagation();
                onOpenMultiSelect();
              }
            }}
            style={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-muted, #9ca3af)',
              padding: '4px',
            }}
          >
            <Archive size={14} color="#333" />
          </div>
        </div>
      </div>

      <div
        {...getMenuProps()}
        style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          right: 0,
          backgroundColor: '#fff',
          border: isOpen ? '1px solid var(--color-border, #e5e7eb)' : 'none',
          borderRadius: '4px',
          boxShadow: isOpen ? '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' : 'none',
          zIndex: 1000,
          maxHeight: '260px',
          display: isOpen ? 'flex' : 'none',
          flexDirection: 'column',
        }}
      >
        <div
          style={{ overflowY: 'auto', flex: 1, maxHeight: '220px' }}
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
            <div style={{ padding: '8px 12px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
              No matching items.
            </div>
          )}
          {isOpen && fetchedOptions.map((opt, index) => (
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
                backgroundColor: highlightedIndex === index ? 'var(--color-surface-2, #f3f4f6)' : selectedItem?.id === opt.id ? 'var(--color-primary-soft)' : 'transparent',
                color: 'var(--color-text)',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-surface-2, #f3f4f6)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#fff')}
          >
            {footerAction.text}
          </div>
        )}
      </div>
    </div>
  );
}
