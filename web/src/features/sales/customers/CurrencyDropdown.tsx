import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp, Search, Check } from 'lucide-react';

interface Currency {
  id: string;
  currencyCode: string;
  currencyName: string;
  isActive?: boolean;
}

interface CurrencyDropdownProps {
  value: string;
  onChange: (value: string) => void;
  currencies?: Currency[];
  style?: React.CSSProperties;
  onAddNew?: () => void;
}

export function CurrencyDropdown({ value, onChange, currencies = [], style, onAddNew }: CurrencyDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredCurrencies = currencies.filter(c => 
    (c.isActive !== false || c.currencyCode === value) &&
    (c.currencyCode.toLowerCase().includes(search.toLowerCase()) ||
    c.currencyName.toLowerCase().includes(search.toLowerCase()))
  );

  const selectedCurrency = currencies.find(c => c.currencyCode === value);

  return (
    <div ref={dropdownRef} style={{ position: 'relative', width: '100%', ...style }}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '5px 10px',
          border: `1px solid ${isOpen ? '#3b82f6' : '#d1d5db'}`,
          borderRadius: '4px',
          backgroundColor: '#fff',
          cursor: 'pointer',
          fontSize: '13px',
          color: '#374151',
          boxShadow: isOpen ? '0 0 0 1px #3b82f6' : 'none',
        }}
      >
        <span>
          {selectedCurrency 
            ? `${selectedCurrency.currencyCode} - ${selectedCurrency.currencyName}` 
            : 'Select Currency'}
        </span>
        {isOpen ? <ChevronUp size={16} color="#3b82f6" /> : <ChevronDown size={16} color="#9ca3af" />}
      </div>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '4px',
            backgroundColor: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: '8px' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} color="#9ca3af" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                style={{
                  width: '100%',
                  padding: '5px 10px 5px 30px',
                  border: '1px solid #3b82f6',
                  borderRadius: '4px',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
                autoFocus
              />
            </div>
          </div>

          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {filteredCurrencies.map((c) => {
              const isSelected = value === c.currencyCode;
              return (
                <div
                  key={c.id}
                  onClick={() => {
                    onChange(c.currencyCode);
                    setIsOpen(false);
                    setSearch('');
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.backgroundColor = '#3b82f6';
                      e.currentTarget.style.color = '#fff';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = '#374151';
                    }
                  }}
                  style={{
                    padding: '6px 12px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: isSelected ? '#f3f4f6' : 'transparent',
                    color: '#374151',
                  }}
                >
                  <span>{c.currencyCode} - {c.currencyName}</span>
                  {isSelected && <Check size={16} color="#3b82f6" />}
                </div>
              );
            })}
            {filteredCurrencies.length === 0 && (
              <div style={{ padding: '8px 16px', fontSize: '13px', color: '#9ca3af', textAlign: 'center' }}>
                No currencies found
              </div>
            )}
          </div>
          {onAddNew && (
            <div
              style={{
                borderTop: '1px solid #e5e7eb',
                padding: '4px',
              }}
              onClick={() => {
                setIsOpen(false);
              }}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsOpen(false);
                  onAddNew();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '8px 12px',
                  color: '#0062ff',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  textAlign: 'left',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#0062ff',
                    color: '#fff',
                    borderRadius: '50%',
                    width: '16px',
                    height: '16px',
                  }}
                >
                  <span style={{ fontSize: '14px', lineHeight: '16px' }}>+</span>
                </div>
                New Currency
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
