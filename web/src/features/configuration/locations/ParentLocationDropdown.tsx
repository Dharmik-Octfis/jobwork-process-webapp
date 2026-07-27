import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp, Search, Check } from 'lucide-react';

export interface FlattenedLocation {
  id: string;
  name: string;
  depth: number;
}

interface ParentLocationDropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: FlattenedLocation[];
  style?: React.CSSProperties;
}

export function ParentLocationDropdown({ value, onChange, options = [], style }: ParentLocationDropdownProps) {
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

  const filteredOptions = options.filter(opt => 
    opt.name.toLowerCase().includes(search.toLowerCase())
  );

  const selectedOption = options.find(opt => opt.id === value);

  return (
    <div ref={dropdownRef} style={{ position: 'relative', width: '100%', ...style }}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          border: `1px solid ${isOpen ? '#3b82f6' : '#d1d5db'}`,
          borderRadius: '4px',
          backgroundColor: '#fff',
          cursor: 'pointer',
          fontSize: '13px',
          color: '#374151',
          boxShadow: isOpen ? '0 0 0 1px #3b82f6' : 'none',
          minHeight: '32px',
        }}
      >
        <span>
          {selectedOption ? (
            <span>{selectedOption.name}</span>
          ) : (
            <span style={{ color: '#9ca3af' }}>Select Location</span>
          )}
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
                  padding: '6px 10px 6px 30px',
                  border: '1px solid #3b82f6',
                  borderRadius: '6px',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
                autoFocus
              />
            </div>
          </div>

          <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
            {filteredOptions.map((opt) => {
              const isSelected = value === opt.id;
              return (
                <div
                  key={opt.id}
                  onClick={() => {
                    onChange(opt.id);
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
                    padding: '8px 12px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: isSelected ? '#f1f5f9' : 'transparent',
                    color: isSelected ? '#111' : '#374151',
                  }}
                >
                  <span style={{ paddingLeft: `${opt.depth * 16}px` }}>
                    {opt.depth > 0 && <span style={{ marginRight: '6px' }}>•</span>}
                    {opt.name}
                  </span>
                  {isSelected && <Check size={16} color="#3b82f6" />}
                </div>
              );
            })}
            {filteredOptions.length === 0 && (
              <div style={{ padding: '8px 16px', fontSize: '13px', color: '#9ca3af', textAlign: 'center' }}>
                No locations found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
