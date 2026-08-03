import { Check, ChevronDown } from 'lucide-react';
import { useSelect } from 'downshift';

export interface SelectOption {
  value: string;
  label: string;
}

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
  const selected = options.find((o) => o.value === value);

  const {
    isOpen,
    getToggleButtonProps,
    getMenuProps,
    highlightedIndex,
    getItemProps,
  } = useSelect({
    items: options,
    selectedItem: selected || null,
    itemToString: (item) => (item ? item.label : ''),
    onSelectedItemChange: ({ selectedItem }) => {
      if (selectedItem) {
        onChange(selectedItem.value);
      }
    },
  });

  return (
    <div style={{ position: 'relative', minWidth, width: fullWidth ? '100%' : minWidth, ...containerStyle }}>
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
          }
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

      <div
        {...getMenuProps()}
        style={{
          position: 'absolute',
          ...(dropUp ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
          left: 0,
          right: 0,
          background: 'var(--color-surface)',
          border: isOpen && !disabled ? '1px solid var(--color-border)' : 'none',
          borderRadius: 'var(--radius-md)',
          boxShadow: isOpen && !disabled ? 'var(--shadow-md)' : 'none',
          zIndex: 70,
          overflow: 'hidden auto',
          maxHeight: 260,
          display: isOpen && !disabled ? 'flex' : 'none',
          flexDirection: 'column',
        }}
      >
        {isOpen && !disabled && (
          <>
            <div style={{ overflow: 'hidden auto' }}>
              {options.length === 0 ? (
                <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--color-text-subtle)' }}>
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
                        background: highlightedIndex === index ? 'var(--color-surface-2)' : isSelected ? 'var(--color-primary-soft)' : 'transparent',
                        fontFamily: 'var(--font-sans)',
                        fontSize: 13,
                        color: 'var(--color-text)',
                        cursor: 'pointer',
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
      </div>
    </div>
  );
}
