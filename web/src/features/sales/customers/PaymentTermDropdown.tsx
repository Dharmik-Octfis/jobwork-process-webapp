import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp, Search, Check, PlusCircle } from 'lucide-react';
import type { PaymentTerm } from './payment-terms.api';

interface PaymentTermDropdownProps {
  value: string;
  onChange: (value: string) => void;
  paymentTerms?: PaymentTerm[];
  onAddNew: () => void;
  style?: React.CSSProperties;
}

export function PaymentTermDropdown({ value, onChange, paymentTerms = [], onAddNew, style }: PaymentTermDropdownProps) {
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

  const filteredTerms = paymentTerms.filter(pt => 
    pt.termName.toLowerCase().includes(search.toLowerCase())
  );

  const selectedTerm = paymentTerms.find(pt => pt.termName === value);

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
        <span>{selectedTerm ? selectedTerm.termName : 'Select Terms'}</span>
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
            {filteredTerms.map((pt) => {
              const isSelected = value === pt.termName;
              return (
                <div
                  key={pt.id}
                  onClick={() => {
                    onChange(pt.termName);
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
                  <span>{pt.termName}</span>
                  {isSelected && <Check size={16} color="#3b82f6" />}
                </div>
              );
            })}
            {filteredTerms.length === 0 && (
              <div style={{ padding: '8px 16px', fontSize: '13px', color: '#9ca3af', textAlign: 'center' }}>
                No terms found
              </div>
            )}
          </div>

          <div
            onClick={() => {
              setIsOpen(false);
              onAddNew();
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f9fafb';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#fff';
            }}
            style={{
              padding: '8px 12px',
              borderTop: '1px solid #e5e7eb',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: '#3b82f6',
              fontSize: '13px',
              fontWeight: 500,
              backgroundColor: '#fff',
              borderBottomLeftRadius: '6px',
              borderBottomRightRadius: '6px',
            }}
          >
            <PlusCircle size={16} fill="#3b82f6" color="#fff" />
            New Payment Term
          </div>
        </div>
      )}
    </div>
  );
}
