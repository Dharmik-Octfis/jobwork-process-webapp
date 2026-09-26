import React from 'react';

export interface JobOrderStatusBadgeProps {
  status?: string | null;
  size?: 'sm' | 'md';
  variant?: 'badge' | 'pill' | 'text';
  style?: React.CSSProperties;
}

function getJobOrderStatusStyle(status?: string | null) {
  const norm = (status || 'draft').toLowerCase().trim();

  if (norm === 'pending') {
    return {
      bg: '#fff7ed',
      text: '#ea580c',
      border: '#fed7aa',
      label: 'PENDING',
    };
  }

  if (norm === 'in_progress' || norm === 'in progress' || norm === 'open' || norm === 'active') {
    return {
      bg: '#f0f7fd',
      text: '#0284c7',
      border: 'rgba(2, 132, 199, 0.25)',
      label: 'IN PROGRESS',
    };
  }

  if (norm === 'completed' || norm === 'closed') {
    return {
      bg: '#ecfdf5',
      text: '#059669',
      border: '#a7f3d0',
      label: 'COMPLETED',
    };
  }

  if (norm === 'short_closed' || norm === 'closed short' || norm === 'short closed') {
    return {
      bg: '#fffbeb',
      text: '#d97706',
      border: '#fde68a',
      label: 'CLOSED SHORT',
    };
  }

  if (norm === 'cancelled' || norm === 'void') {
    return {
      bg: '#fff1f2',
      text: '#dc2626',
      border: '#fecdd3',
      label: 'CANCELLED',
    };
  }

  // Default: Draft
  return {
    bg: '#f1f5f9',
    text: '#64748b',
    border: '#e2e8f0',
    label: 'DRAFT',
  };
}

export function JobOrderStatusBadge({
  status,
  size = 'sm',
  variant = 'badge',
  style,
}: JobOrderStatusBadgeProps) {
  const { bg, text, border, label } = getJobOrderStatusStyle(status);
  const displayLabel = label;

  if (variant === 'text') {
    return (
      <span
        style={{
          display: 'inline-block',
          color: text,
          fontSize: size === 'md' ? '13px' : '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
          whiteSpace: 'nowrap',
          lineHeight: 1.4,
          ...style,
        }}
      >
        {displayLabel}
      </span>
    );
  }

  const isMd = size === 'md';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: isMd ? '3px 10px' : '2px 8px',
        borderRadius: variant === 'pill' ? '999px' : '12px',
        fontSize: isMd ? '12px' : '11px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.03em',
        background: bg,
        color: text,
        border: `1px solid ${border}`,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {displayLabel}
    </span>
  );
}
