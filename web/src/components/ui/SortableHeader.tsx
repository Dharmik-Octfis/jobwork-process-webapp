import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { SortDirection } from '../../hooks/useTableSort';

interface SortableHeaderProps<T extends string = string> {
  label: React.ReactNode;
  sortKey: T;
  currentSortField?: string;
  currentSortDirection?: SortDirection;
  onSort: (key: T) => void;
  style?: React.CSSProperties;
  align?: 'left' | 'center' | 'right';
}

export function SortableHeader<T extends string = string>({
  label,
  sortKey,
  currentSortField,
  currentSortDirection,
  onSort,
  style,
  align = 'left',
}: SortableHeaderProps<T>) {
  const isActive = currentSortField === sortKey;
  
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{ ...style, textAlign: align, cursor: 'pointer', userSelect: 'none' }}
    >
      <div 
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start', 
          gap: '6px' 
        }}
      >
        <span>{label}</span>
        <span style={{ display: 'flex', alignItems: 'center', marginTop: '2px' }}>
          {isActive ? (
            currentSortDirection === 'asc' ? (
              <ArrowUp size={14} color="#0062ff" />
            ) : (
              <ArrowDown size={14} color="#0062ff" />
            )
          ) : (
            <ArrowUpDown size={14} color="#d1d5db" />
          )}
        </span>
      </div>
    </th>
  );
}
