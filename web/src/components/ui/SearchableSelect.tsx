import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';

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
  className?: string;
  renderOption?: (option: Option, isSelected: boolean) => React.ReactNode;
  renderValue?: (option: Option) => React.ReactNode;
  footerAction?: { text: string; icon?: React.ReactNode; onClick: () => void };
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  style,
  className,
  renderOption,
  renderValue,
  footerAction,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = options.filter(
    (opt) =>
      opt.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      opt.value.toLowerCase().includes(searchTerm.toLowerCase()),
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
    >
      <div
        className={className}
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

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            backgroundColor: 'white',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
            zIndex: 1000,
            maxHeight: 300,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: 8, borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ position: 'relative' }}>
              <Search
                size={14}
                color="#9CA3AF"
                style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }}
              />
              <input
                type="text"
                placeholder="Search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
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
              filteredOptions.map((opt) => (
                <div
                  key={opt.value}
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
                    backgroundColor: opt.value === value ? 'var(--color-primary)' : 'transparent',
                    color: opt.disabled
                      ? 'var(--color-text-muted)'
                      : opt.value === value
                        ? 'white'
                        : 'inherit',
                    opacity: opt.disabled ? 0.6 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (opt.value !== value && !opt.disabled) {
                      e.currentTarget.style.backgroundColor = '#EFF6FF'; // light blue for hover
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (opt.value !== value && !opt.disabled) {
                      e.currentTarget.style.backgroundColor = 'transparent';
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
      )}
    </div>
  );
}
