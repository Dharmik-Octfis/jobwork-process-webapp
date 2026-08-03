import { Check, ChevronDown } from 'lucide-react';
import { useCombobox } from 'downshift';

interface ComboBoxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  hasError?: boolean;
  style?: React.CSSProperties;
  onBlur?: () => void;
  name?: string;
}

export function ComboBox({
  value,
  onChange,
  options,
  placeholder,
  hasError,
  style,
  onBlur,
  name,
}: ComboBoxProps) {
  const {
    isOpen,
    getToggleButtonProps,
    getMenuProps,
    getInputProps,
    highlightedIndex,
    getItemProps,
  } = useCombobox({
    items: options,
    inputValue: value,
    selectedItem: value,
    onInputValueChange: ({ inputValue }) => {
      if (inputValue !== undefined) {
        onChange(inputValue);
      }
    },
    onSelectedItemChange: ({ selectedItem }) => {
      if (selectedItem !== undefined && selectedItem !== null) {
        onChange(selectedItem);
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
              if (onBlur) onBlur();
            },
            onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
              e.target.style.borderColor = 'var(--color-primary)';
            },
            style: {
              width: '100%',
              padding: '6px 30px 6px 8px',
              fontSize: '13px',
              border: `1px solid ${hasError ? 'var(--color-danger, #ef4444)' : 'var(--color-border, #d1d5db)'}`,
              borderRadius: '4px',
              boxSizing: 'border-box',
              outline: 'none',
            },
          })}
          onBlurCapture={(e: React.FocusEvent<HTMLInputElement>) => {
            e.target.style.borderColor = hasError ? 'var(--color-danger, #ef4444)' : 'var(--color-border, #d1d5db)';
          }}
        />
        <div 
          {...getToggleButtonProps()}
          style={{
            position: 'absolute',
            right: '8px',
            top: '50%',
            transform: 'translateY(-50%)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-muted, #9ca3af)',
            padding: '4px',
          }}
        >
          <ChevronDown size={14} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
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
          border: isOpen && options.length > 0 ? '1px solid var(--color-border, #e5e7eb)' : 'none',
          borderRadius: '4px',
          boxShadow: isOpen && options.length > 0 ? '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' : 'none',
          zIndex: 1000,
          maxHeight: '200px',
          overflowY: 'auto',
          display: isOpen && options.length > 0 ? 'block' : 'none'
        }}
      >
        {isOpen && options.map((opt, index) => (
          <div
            {...getItemProps({ item: opt, index })}
            key={opt}
            style={{
              padding: '8px 12px',
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: highlightedIndex === index ? 'var(--color-surface-2, #f3f4f6)' : value === opt ? 'var(--color-primary-soft)' : 'transparent',
              color: 'var(--color-text)',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt}</span>
            {value === opt && <Check size={14} color="var(--color-primary)" />}
          </div>
        ))}
      </div>
    </div>
  );
}
