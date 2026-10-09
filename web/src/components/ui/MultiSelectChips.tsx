import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, ChevronUp, X } from 'lucide-react';

const PORTAL_Z_INDEX = 1300;
const MENU_MAX_HEIGHT = 280;
const MENU_MIN_HEIGHT = 180;

export interface MultiSelectChipOption {
  label: string;
  value: string;
  subLabel?: string;
  badge?: string;
  disabled?: boolean;
}

export interface MultiSelectChipsProps {
  options: MultiSelectChipOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  portal?: boolean;
  style?: React.CSSProperties;
  triggerStyle?: React.CSSProperties;
  className?: string;
  onSelectAll?: () => void;
  onClearAll?: () => void;
}

export const MultiSelectChips: React.FC<MultiSelectChipsProps> = ({
  options,
  values,
  onChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search',
  disabled = false,
  portal = true,
  style,
  triggerStyle,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });

  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setIsOpen(false);
      setSearchTerm('');
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIsOpen(false);
        setSearchTerm('');
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen]);

  // Position calculation for portalled dropdown
  useLayoutEffect(() => {
    if (!portal || !isOpen) return undefined;
    const place = () => {
      const anchor = triggerRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const dropUp = spaceBelow < MENU_MIN_HEIGHT && spaceAbove > spaceBelow;

      setMenuPosition({
        position: 'fixed',
        left: rect.left,
        width: rect.width,
        zIndex: PORTAL_Z_INDEX,
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
  }, [portal, isOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const selectOption = (optionValue: string) => {
    onChange([...values, optionValue]);
  };

  const removeValue = (valToRemove: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onChange(values.filter((v) => v !== valToRemove));
  };

  // Only show options that have NOT yet been selected in the dropdown
  const availableOptions = options.filter((opt) => !values.includes(opt.value));

  const filteredOptions = availableOptions.filter((opt) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    const lMatch = opt.label.toLowerCase().includes(q);
    const subMatch = opt.subLabel ? opt.subLabel.toLowerCase().includes(q) : false;
    return lMatch || subMatch;
  });

  const selectedOptions = values
    .map((val) => options.find((o) => o.value === val) || { label: val, value: val })
    .filter(Boolean);

  const menuContent = (
    <div
      ref={menuRef}
      style={{
        ...(portal
          ? menuPosition
          : {
              position: 'absolute',
              top: '100%',
              left: 0,
              width: '100%',
              marginTop: 4,
              zIndex: 100,
            }),
        backgroundColor: '#ffffff',
        border: '1px solid #cbd5e1',
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        padding: 6,
      }}
    >
      {/* Search Input Box */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          border: '1px solid #3b82f6',
          borderRadius: 4,
          padding: '6px 8px',
          backgroundColor: '#ffffff',
          marginBottom: 4,
        }}
      >
        <Search size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
        <input
          ref={searchInputRef}
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={searchPlaceholder}
          style={{
            border: 'none',
            outline: 'none',
            fontSize: 13,
            width: '100%',
            backgroundColor: 'transparent',
            color: '#1e293b',
          }}
        />
      </div>

      {/* Options List (Unselected Options Only) */}
      <div
        style={{
          maxHeight: 200,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {filteredOptions.length === 0 ? (
          <div
            style={{ padding: '10px 12px', fontSize: 13, color: '#94a3b8', textAlign: 'center' }}
          >
            {availableOptions.length === 0 ? 'All options selected' : 'No options found'}
          </div>
        ) : (
          filteredOptions.map((opt) => (
            <div
              key={opt.value}
              onClick={() => !opt.disabled && selectOption(opt.value)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderRadius: 4,
                cursor: opt.disabled ? 'not-allowed' : 'pointer',
                backgroundColor: '#ffffff',
                color: '#1e293b',
                fontSize: 13,
                fontWeight: 500,
                transition: 'background-color 0.1s ease, color 0.1s ease',
                userSelect: 'none',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#2563eb';
                e.currentTarget.style.color = '#ffffff';
                const sub = e.currentTarget.querySelector('.sub-label') as HTMLElement;
                if (sub) sub.style.color = '#dbeafe';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#ffffff';
                e.currentTarget.style.color = '#1e293b';
                const sub = e.currentTarget.querySelector('.sub-label') as HTMLElement;
                if (sub) sub.style.color = '#64748b';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                <span
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {opt.label}
                </span>
                {opt.subLabel && (
                  <span
                    className="sub-label"
                    style={{
                      fontSize: 12,
                      color: '#64748b',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {opt.subLabel}
                  </span>
                )}
              </div>

              {opt.badge && (
                <span
                  style={{
                    fontSize: 11,
                    backgroundColor: '#e2e8f0',
                    color: '#475569',
                    padding: '1px 6px',
                    borderRadius: 10,
                    flexShrink: 0,
                  }}
                >
                  {opt.badge}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div
      ref={dropdownRef}
      style={{
        position: 'relative',
        width: '100%',
        ...style,
      }}
      className={className}
    >
      {/* Trigger Box with Chips / Tags (Zoho Style) */}
      <div
        ref={triggerRef}
        tabIndex={disabled ? -1 : 0}
        onClick={() => {
          if (!disabled) {
            setIsOpen((prev) => {
              if (!prev) setSearchTerm('');
              return !prev;
            });
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 34,
          padding: '4px 8px',
          borderRadius: 4,
          border: isOpen ? '1px solid #3b82f6' : '1px solid #cbd5e1',
          boxShadow: isOpen ? '0 0 0 2px rgba(59, 130, 246, 0.2)' : 'none',
          backgroundColor: disabled ? '#f8fafc' : '#ffffff',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
          gap: 6,
          ...triggerStyle,
        }}
      >
        {/* Selected Chips */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
            alignItems: 'center',
            flex: 1,
            overflow: 'hidden',
          }}
        >
          {selectedOptions.length === 0 ? (
            <span style={{ color: '#94a3b8', fontSize: 13, userSelect: 'none' }}>
              {placeholder}
            </span>
          ) : (
            selectedOptions.map((opt) => (
              <span
                key={opt.value}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  backgroundColor: '#f1f5f9',
                  border: '1px solid #e2e8f0',
                  color: '#1e293b',
                  fontSize: 12,
                  fontWeight: 500,
                  padding: '2px 6px',
                  borderRadius: 4,
                  lineHeight: 1.3,
                  userSelect: 'none',
                }}
              >
                <span>{opt.label}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => removeValue(opt.value, e)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      removeValue(opt.value);
                    }
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#64748b',
                    cursor: 'pointer',
                    borderRadius: 2,
                    padding: 1,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#64748b')}
                  title="Remove"
                >
                  <X size={12} strokeWidth={2.5} />
                </span>
              </span>
            ))
          )}
        </div>

        {/* Chevron Icon */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            color: isOpen ? '#3b82f6' : '#64748b',
            flexShrink: 0,
            marginLeft: 4,
          }}
        >
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* Render Dropdown Menu (via Portal if enabled) */}
      {isOpen && (portal ? createPortal(menuContent, document.body) : menuContent)}
    </div>
  );
};
