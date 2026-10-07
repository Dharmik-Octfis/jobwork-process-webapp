import { useState, useMemo } from 'react';

export type SortDirection = 'asc' | 'desc' | null;

export function useTableSort<T>(rows: T[], defaultSortField?: Extract<keyof T, string> | string, defaultDirection: SortDirection = null) {
  const [sortField, setSortField] = useState<Extract<keyof T, string> | string | undefined>(defaultSortField);
  const [sortDirection, setSortDirection] = useState<SortDirection>(defaultDirection);

  const handleSort = (field: Extract<keyof T, string> | string) => {
    if (sortField === field) {
      if (sortDirection === 'asc') setSortDirection('desc');
      else if (sortDirection === 'desc') {
        setSortDirection(null);
        setSortField(undefined);
      }
      else setSortDirection('asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedRows = useMemo(() => {
    if (!sortField || !sortDirection) return rows;

    return [...rows].sort((a: T, b: T) => {
      const aVal = a[sortField as keyof T];
      const bVal = b[sortField as keyof T];

      if (aVal === bVal) return 0;
      
      const aEmpty = aVal === null || aVal === undefined || aVal === '';
      const bEmpty = bVal === null || bVal === undefined || bVal === '';
      
      if (aEmpty && !bEmpty) return sortDirection === 'asc' ? 1 : -1;
      if (!aEmpty && bEmpty) return sortDirection === 'asc' ? -1 : 1;
      if (aEmpty && bEmpty) return 0;

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      const aString = String(aVal).toLowerCase();
      const bString = String(bVal).toLowerCase();

      if (aString < bString) return sortDirection === 'asc' ? -1 : 1;
      if (aString > bString) return sortDirection === 'asc' ? 1 : -1;
      
      return 0;
    });
  }, [rows, sortField, sortDirection]);

  return { sortedRows, sortField, sortDirection, handleSort };
}
