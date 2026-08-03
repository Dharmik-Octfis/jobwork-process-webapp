import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';

type CountryCode = {
  dialCode: string;
  name: string;
};

type PhoneInputProps = {
  value: string;
  onChange: (value: string) => void;
  countries: CountryCode[];
};

export const PhoneInput: React.FC<PhoneInputProps> = ({ value, onChange, countries }) => {
  const [prevValue, setPrevValue] = useState(value);
  const [dialCode, setDialCode] = useState(() => {
    if (value) {
      const parts = value.split(' ');
      if (parts.length > 1 && parts[0].startsWith('+')) {
        return parts[0];
      }
    }
    return '+91';
  });
  const [number, setNumber] = useState(() => {
    if (value) {
      const parts = value.split(' ');
      if (parts.length > 1 && parts[0].startsWith('+')) {
        return parts.slice(1).join(' ');
      }
      return value;
    }
    return '';
  });
  
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  if (value !== prevValue) {
    setPrevValue(value);
    if (value) {
      const parts = value.split(' ');
      if (parts.length > 1 && parts[0].startsWith('+')) {
        setDialCode(parts[0]);
        setNumber(parts.slice(1).join(' '));
      } else {
        setNumber(value);
      }
    } else {
      setDialCode('+91');
      setNumber('');
    }
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDialCodeSelect = (newDialCode: string) => {
    setDialCode(newDialCode);
    setIsOpen(false);
    setSearchQuery('');
    if (number) {
      onChange(`${newDialCode} ${number}`);
    } else {
      onChange('');
    }
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newNumber = e.target.value;
    setNumber(newNumber);
    if (newNumber) {
      onChange(`${dialCode || '+91'} ${newNumber}`);
    } else {
      onChange('');
    }
  };

  // Deduplicate and filter dial codes based on search
  const uniqueCountries = Array.from(
    new Map(
      countries
        .filter(c => c.dialCode && c.dialCode.startsWith('+'))
        .map(c => [c.dialCode, c])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  const filteredCountries = uniqueCountries.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    c.dialCode.includes(searchQuery)
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        border: '1px solid #d9d9d9',
        borderRadius: '4px',
        height: '32px',
        backgroundColor: '#fff',
        position: 'relative',
      }}
      ref={dropdownRef}
    >
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '0 8px',
          height: '100%',
          cursor: 'pointer',
          borderRight: '1px solid #d9d9d9',
          backgroundColor: '#fff',
          fontSize: '13px',
          color: '#333',
          borderTopLeftRadius: '4px',
          borderBottomLeftRadius: '4px',
        }}
      >
        <span>{dialCode}</span>
        {isOpen ? <ChevronUp size={14} color="#3b82f6" /> : <ChevronDown size={14} color="#6b7280" />}
      </div>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            width: '280px',
            backgroundColor: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            zIndex: 1000,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                border: '1px solid #3b82f6',
                borderRadius: '6px',
                padding: '4px 8px',
              }}
            >
              <Search size={14} color="#9ca3af" />
              <input
                type="text"
                autoFocus
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  border: 'none',
                  outline: 'none',
                  fontSize: '13px',
                  marginLeft: '8px',
                  width: '100%',
                }}
              />
            </div>
          </div>
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {filteredCountries.map((country) => (
              <div
                key={country.dialCode}
                onClick={() => handleDialCodeSelect(country.dialCode)}
                style={{
                  padding: '8px 12px',
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'center',
                  color: '#374151',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f3f4f6')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <span style={{ width: '40px', color: '#6b7280' }}>{country.dialCode}</span>
                <span>{country.name}</span>
              </div>
            ))}
            {filteredCountries.length === 0 && (
              <div style={{ padding: '8px 12px', fontSize: '13px', color: '#6b7280', textAlign: 'center' }}>
                No results found
              </div>
            )}
          </div>
        </div>
      )}

      <input
        type="text"
        value={number}
        onChange={handleNumberChange}
        maxLength={10}
        onKeyPress={(e) => {
          if (!/[0-9]/.test(e.key)) e.preventDefault();
        }}
        style={{
          flex: 1,
          border: 'none',
          padding: '0 8px',
          outline: 'none',
          height: '100%',
          width: '100%',
          fontSize: '13px',
          borderTopRightRadius: '4px',
          borderBottomRightRadius: '4px',
        }}
      />
    </div>
  );
};
