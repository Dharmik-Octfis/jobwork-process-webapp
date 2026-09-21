import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';

interface DateTimeInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onChange: (val: string) => void;
  type?: 'date' | 'time' | 'datetime-local';
  defaultToCurrent?: boolean;
  hasError?: boolean;
}

export function DateTimeInput({
  value,
  onChange,
  type = 'datetime-local',
  defaultToCurrent = true,
  hasError = false,
  className,
  style,
  ...rest
}: DateTimeInputProps) {
  const [focused, setFocused] = useState(false);
  const borderColor = hasError ? '#ef4444' : focused ? '#2563eb' : '#d1d5db';
  const ringColor = hasError ? 'rgba(239, 68, 68, 0.18)' : 'rgba(37, 99, 235, 0.18)';

  useEffect(() => {
    if (defaultToCurrent && !value) {
      const now = new Date();
      if (type === 'date') {
        onChange(format(now, 'yyyy-MM-dd'));
      } else if (type === 'time') {
        onChange(format(now, 'HH:mm'));
      } else if (type === 'datetime-local') {
        onChange(format(now, "yyyy-MM-dd'T'HH:mm"));
      }
    }
  }, [defaultToCurrent, value, onChange, type]);

  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      aria-invalid={hasError || undefined}
      className={className}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: '6px 8px',
        fontFamily: 'inherit',
        fontSize: 13,
        border: `1px solid ${borderColor}`,
        borderRadius: 4,
        background: rest.disabled ? '#f8fafc' : '#fff',
        minHeight: 32,
        outline: 'none',
        ...(focused ? { boxShadow: `0 0 0 2px ${ringColor}` } : {}),
        ...style,
      }}
      {...rest}
    />
  );
}
