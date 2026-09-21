import { useState, useRef, useEffect } from 'react';
import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, startOfWeek, startOfMonth, startOfYear, subDays, subWeeks, subMonths, subYears, subQuarters, startOfQuarter, addMonths, getDaysInMonth, setDate, getDay, startOfDay, endOfDay, endOfWeek, endOfMonth, endOfQuarter, endOfYear } from 'date-fns';

const PRESETS = [
  { label: 'Today', getValue: () => startOfDay(new Date()), getRange: () => [startOfDay(new Date()), endOfDay(new Date())] },
  { label: 'This Week', getValue: () => startOfWeek(new Date(), { weekStartsOn: 1 }), getRange: () => [startOfWeek(new Date(), { weekStartsOn: 1 }), endOfWeek(new Date(), { weekStartsOn: 1 })] },
  { label: 'This Month', getValue: () => startOfMonth(new Date()), getRange: () => [startOfMonth(new Date()), endOfMonth(new Date())] },
  { label: 'This Quarter', getValue: () => startOfQuarter(new Date()), getRange: () => [startOfQuarter(new Date()), endOfQuarter(new Date())] },
  { label: 'This Year', getValue: () => startOfYear(new Date()), getRange: () => [startOfYear(new Date()), endOfYear(new Date())] },
  { label: 'Yesterday', getValue: () => startOfDay(subDays(new Date(), 1)), getRange: () => [startOfDay(subDays(new Date(), 1)), endOfDay(subDays(new Date(), 1))] },
  { label: 'Previous Week', getValue: () => startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }), getRange: () => [startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }), endOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 })] },
  { label: 'Previous Month', getValue: () => startOfMonth(subMonths(new Date(), 1)), getRange: () => [startOfMonth(subMonths(new Date(), 1)), endOfMonth(subMonths(new Date(), 1))] },
  { label: 'Previous Quarter', getValue: () => startOfQuarter(subQuarters(new Date(), 1)), getRange: () => [startOfQuarter(subQuarters(new Date(), 1)), endOfQuarter(subQuarters(new Date(), 1))] },
  { label: 'Previous Year', getValue: () => startOfYear(subYears(new Date(), 1)), getRange: () => [startOfYear(subYears(new Date(), 1)), endOfYear(subYears(new Date(), 1))] },
  { label: 'Custom', getValue: () => null, getRange: () => null },
];

export function ReportDateFilter({ value, onChange, labelPrefix = 'As of :', isRange = false, onChangeRange }: { value: string; onChange?: (label: string, date: Date) => void; labelPrefix?: string; isRange?: boolean; onChangeRange?: (label: string, startDate: Date, endDate: Date) => void; }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(value);
  const [customDate, setCustomDate] = useState<Date>(new Date());
  const [customEndDate, setCustomEndDate] = useState<Date>(new Date());
  const [selectingEnd, setSelectingEnd] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleApply = () => {
    if (isRange && onChangeRange) {
      // Ensure start is before end
      const start = customDate <= customEndDate ? customDate : customEndDate;
      const end = customDate <= customEndDate ? customEndDate : customDate;
      onChangeRange(format(start, 'dd-MM-yyyy') + ' - ' + format(end, 'dd-MM-yyyy'), start, end);
    } else if (onChange) {
      onChange(format(customDate, 'dd-MM-yyyy'), customDate);
    }
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', flexShrink: 0 }}>
      <div
        onClick={() => {
          if (!isOpen) {
            setSelectedPreset(value);
          }
          setIsOpen(!isOpen);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          border: '1px solid #d1d5db',
          borderRadius: '6px',
          padding: '4px 10px',
          fontSize: '12px',
          background: '#fff',
          gap: '6px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        }}
      >
        {labelPrefix && <span style={{ color: '#6b7280' }}>{labelPrefix}</span>}
        <span style={{ color: '#111827', fontWeight: 500 }}>{value}</span>
        <ChevronDown size={14} color="#9ca3af" style={{ marginLeft: '4px' }} />
      </div>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: '4px',
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
            zIndex: 50,
            display: 'flex',
            minWidth: selectedPreset === 'Custom' ? '500px' : 'auto',
            overflow: 'hidden',
          }}
        >
          {/* Presets List */}
          <div style={{ width: '200px', borderRight: selectedPreset === 'Custom' ? '1px solid #e5e7eb' : 'none', background: '#fff', padding: '8px' }}>
            {PRESETS.map((p) => (
              <div
                key={p.label}
                onClick={() => {
                  setSelectedPreset(p.label);
                  if (p.label !== 'Custom') {
                    if (isRange && onChangeRange) {
                      const [start, end] = p.getRange() as [Date, Date];
                      setCustomDate(start);
                      setCustomEndDate(end);
                      onChangeRange(p.label, start, end);
                    } else if (onChange) {
                      const dateVal = p.getValue() as Date;
                      setCustomDate(dateVal);
                      onChange(p.label, dateVal);
                    }
                    setIsOpen(false);
                  }
                }}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  fontSize: '13px',
                  background: selectedPreset === p.label ? '#eff6ff' : 'transparent',
                  color: selectedPreset === p.label ? '#2563eb' : '#374151',
                }}
              >
                {p.label}
              </div>
            ))}
          </div>
          
          {/* Calendar Area */}
          {selectedPreset === 'Custom' && (
            <div style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1 }}>
              {isRange ? (
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                  <div 
                    onClick={() => setSelectingEnd(false)}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', border: `1px solid ${!selectingEnd ? '#2563eb' : '#e5e7eb'}`, borderRadius: '6px', padding: '8px', cursor: 'pointer', background: !selectingEnd ? '#eff6ff' : 'transparent' }}>
                    <CalendarIcon size={16} color={!selectingEnd ? '#2563eb' : '#6b7280'} style={{ marginRight: '8px' }} />
                    <span style={{ fontSize: '13px', color: !selectingEnd ? '#1d4ed8' : '#374151' }}>{format(customDate, 'yyyy-MM-dd')}</span>
                  </div>
                  <div 
                    onClick={() => setSelectingEnd(true)}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', border: `1px solid ${selectingEnd ? '#2563eb' : '#e5e7eb'}`, borderRadius: '6px', padding: '8px', cursor: 'pointer', background: selectingEnd ? '#eff6ff' : 'transparent' }}>
                    <CalendarIcon size={16} color={selectingEnd ? '#2563eb' : '#6b7280'} style={{ marginRight: '8px' }} />
                    <span style={{ fontSize: '13px', color: selectingEnd ? '#1d4ed8' : '#374151' }}>{format(customEndDate, 'yyyy-MM-dd')}</span>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '8px', marginBottom: '16px' }}>
                  <CalendarIcon size={16} color="#6b7280" style={{ marginRight: '8px' }} />
                  <input 
                    type="text" 
                    value={format(customDate, 'yyyy-MM-dd')} 
                    readOnly 
                    style={{ border: 'none', outline: 'none', fontSize: '13px', width: '100%' }} 
                  />
                </div>
              )}
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <ChevronLeft size={16} color="#374151" style={{ cursor: 'pointer' }} onClick={() => selectingEnd ? setCustomEndDate(subMonths(customEndDate, 1)) : setCustomDate(subMonths(customDate, 1))} />
                <div style={{ fontSize: '14px', fontWeight: 500 }}>{format(selectingEnd ? customEndDate : customDate, 'MMM yyyy')}</div>
                <ChevronRight size={16} color="#374151" style={{ cursor: 'pointer' }} onClick={() => selectingEnd ? setCustomEndDate(addMonths(customEndDate, 1)) : setCustomDate(addMonths(customDate, 1))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', fontSize: '12px', color: '#1d4ed8', fontWeight: 600, marginBottom: '8px' }}>
                <div>Su</div><div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div>Sa</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', fontSize: '13px', color: '#374151' }}>
                {Array.from({ length: getDay(startOfMonth(selectingEnd ? customEndDate : customDate)) }).map((_, i) => (
                  <div key={`empty-${i}`} />
                ))}
                {Array.from({ length: getDaysInMonth(selectingEnd ? customEndDate : customDate) }).map((_, i) => {
                  const day = i + 1;
                  const currentDate = selectingEnd ? customEndDate : customDate;
                  const isSelected = day === currentDate.getDate();
                  
                  return (
                    <div 
                      key={day} 
                      onClick={() => selectingEnd ? setCustomEndDate(setDate(customEndDate, day)) : setCustomDate(setDate(customDate, day))}
                      style={{ 
                        padding: '6px 0', 
                        borderRadius: '4px',
                        background: isSelected ? '#2563eb' : 'transparent',
                        color: isSelected ? '#fff' : 'inherit',
                        cursor: 'pointer'
                      }}>
                      {day}
                    </div>
                  );
                })}
              </div>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px', borderTop: '1px solid #e5e7eb', paddingTop: '16px' }}>
              <button onClick={() => setIsOpen(false)} style={{ background: 'transparent', border: 'none', fontWeight: 600, fontSize: '13px', cursor: 'pointer', padding: '6px 12px' }}>Cancel</button>
              <button onClick={handleApply} style={{ background: '#166534', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 600, fontSize: '13px', cursor: 'pointer', padding: '6px 16px' }}>Apply</button>
            </div>
          </div>
          )}
        </div>
      )}
    </div>
  );
}
