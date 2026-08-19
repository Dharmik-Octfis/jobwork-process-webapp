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
  hasError?: boolean;
  dropdownWidth?: string | number;
}

export function SearchableSelect({
  options,
  value,
  hasError,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  style,
  className,
  renderOption,
  renderValue,
  footerAction,
  dropdownWidth,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [menuPlacement, setMenuPlacement] = useState<'bottom' | 'top'>('bottom');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const optionsContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
      opt.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      opt.value.toLowerCase().includes(searchTerm.toLowerCase()),
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

      {isOpen && (
        <div
          style={
            dropdownWidth
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
              ...(dropdownWidth
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
        </div>
      )}
    </div>
  );
}
