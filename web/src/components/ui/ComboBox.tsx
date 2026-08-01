import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

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
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputClick = () => {
    if (!open) setOpen(true);
  };

  const handleSelect = (opt: string) => {
    onChange(opt);
    setOpen(false);
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', ...style }}>
      <div style={{ position: 'relative', width: '100%' }}>
        <input
          name={name}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (!open) setOpen(true);
          }}
          onClick={handleInputClick}
          onBlur={() => {
            if (onBlur) onBlur();
          }}
          placeholder={placeholder}
          autoComplete="off"
          style={{
            width: '100%',
            padding: '6px 30px 6px 8px',
            fontSize: '13px',
            border: `1px solid ${hasError ? 'var(--color-danger, #ef4444)' : 'var(--color-border, #d1d5db)'}`,
            borderRadius: '4px',
            boxSizing: 'border-box',
            outline: 'none',
          }}
          onFocus={(e) => {
             e.target.style.borderColor = 'var(--color-primary)';
          }}
          onBlurCapture={(e) => {
             e.target.style.borderColor = hasError ? 'var(--color-danger, #ef4444)' : 'var(--color-border, #d1d5db)';
          }}
        />
        <div 
          onClick={() => setOpen(!open)}
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
          <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
        </div>
      </div>
      
      {open && options.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            backgroundColor: '#fff',
            border: '1px solid var(--color-border, #e5e7eb)',
            borderRadius: '4px',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
            zIndex: 1000,
            maxHeight: '200px',
            overflowY: 'auto',
          }}
        >
          {options.map((opt, idx) => (
            <div
              key={idx}
              onClick={() => handleSelect(opt)}
              style={{
                padding: '8px 12px',
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: value === opt ? 'var(--color-primary-soft)' : 'transparent',
                color: 'var(--color-text)',
              }}
              onMouseEnter={(e) => {
                if (value !== opt) e.currentTarget.style.backgroundColor = 'var(--color-surface-2, #f3f4f6)';
              }}
              onMouseLeave={(e) => {
                if (value !== opt) e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt}</span>
              {value === opt && <Check size={14} color="var(--color-primary)" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
