import { Check, X } from 'lucide-react';
import { useCombobox } from 'downshift';
import { useState, useMemo, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const PORTAL_Z_INDEX = 1200;
const MENU_MAX_HEIGHT = 260;
const MENU_MIN_HEIGHT = 160;

interface Option {
  value: string;
  label: string;
}

interface LocalComboBoxProps {
  options: Option[];
  value?: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  hasError?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  style?: React.CSSProperties;
  onBlur?: () => void;
  name?: string;
  portal?: boolean;
}

export function LocalComboBox({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  hasError,
  disabled = false,
  ariaLabel,
  style,
  onBlur,
  name,
  portal = false,
}: LocalComboBoxProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const inputId = `${useId()}-local-combobox`;

  const selectedOption = useMemo(() => options.find((opt) => opt.value === value) || null, [options, value]);

  const [inputValue, setInputValue] = useState(selectedOption?.label || '');
  const isInternalChange = useRef(false);

  useEffect(() => {
    if (!isInternalChange.current) {
      setInputValue(selectedOption?.label || '');
    }
    isInternalChange.current = false;
  }, [selectedOption]);

  const filteredOptions = useMemo(() => {
    if (!inputValue || inputValue === selectedOption?.label) return options;
    const lowerInput = inputValue.toLowerCase();
    return options.filter((opt) => opt.label.toLowerCase().includes(lowerInput));
  }, [options, inputValue, selectedOption]);

  const {
    isOpen,
    getMenuProps,
    getInputProps,
    highlightedIndex,
    getItemProps,
    closeMenu,
    openMenu,
  } = useCombobox({
    id: inputId,
    items: filteredOptions,
    itemToString: (item) => (item ? item.label : ''),
    selectedItem: selectedOption,
    inputValue,
    onInputValueChange: ({ inputValue: newInputValue, type }) => {
      setInputValue(newInputValue || '');
      if (type === useCombobox.stateChangeTypes.InputChange) {
        if (selectedOption && newInputValue !== selectedOption.label) {
          isInternalChange.current = true;
          onChange(null);
        } else if (!newInputValue) {
          isInternalChange.current = true;
          onChange(null);
        }
      }
    },
    onSelectedItemChange: ({ selectedItem: newSelectedItem }) => {
      isInternalChange.current = true;
      onChange(newSelectedItem ? newSelectedItem.value : null);
      if (newSelectedItem) {
        setInputValue(newSelectedItem.label);
      }
    },
    stateReducer: (_state, actionAndChanges) => {
      const { type, changes } = actionAndChanges;
      switch (type) {
        case useCombobox.stateChangeTypes.InputClick:
          return { ...changes, isOpen: true };
        default:
          return changes;
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
              if (!isOpen) {
                openMenu();
              }
            },
            onClick: () => {
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
          {selectedOption && !disabled && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                isInternalChange.current = true;
                onChange(null);
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
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {isOpen && filteredOptions.length === 0 && (
              <div
                style={{ padding: '8px 12px', fontSize: '13px', color: 'var(--color-text-muted)' }}
              >
                No options found.
              </div>
            )}
            {isOpen &&
              filteredOptions.map((opt, index) => (
                <div
                  {...getItemProps({ item: opt, index })}
                  key={opt.value}
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
                        : selectedOption?.value === opt.value
                          ? 'var(--color-primary-soft)'
                          : 'transparent',
                    color: 'var(--color-text)',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {opt.label}
                  </span>
                  {selectedOption?.value === opt.value && <Check size={14} color="var(--color-primary)" />}
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
