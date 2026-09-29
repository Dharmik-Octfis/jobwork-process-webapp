import React from 'react';

interface JobOrderStatusBadgeProps {
  status?: string | null;
  size?: 'sm' | 'md';
  variant?: 'badge' | 'text' | 'pill';
  style?: React.CSSProperties;
}

function getJobOrderStatusStyle(status?: string | null) {
  const norm = (status || 'draft').toLowerCase().trim();

  if (norm === 'issued' || norm === 'open') {
    return {
      bg: '#f0f7fd',
      text: '#0284c7',
      border: 'rgba(2, 132, 199, 0.25)',
      label: 'ISSUED',
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

  if (norm === 'partially_received' || norm === 'partially received' || norm === 'partial') {
    return {
      bg: '#fffbeb',
      text: '#d97706',
      border: '#fde68a',
      label: 'PARTIALLY RECEIVED',
    };
  }

  if (norm === 'short_closed' || norm === 'short closed') {
    return {
      bg: '#fef2f2',
      text: '#b91c1c',
      border: '#fecaca',
      label: 'SHORT CLOSED',
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

  // Default: Draft / pending
  return {
    bg: '#f1f5f9',
    text: '#64748b',
    border: '#e2e8f0',
    label: (status || 'draft').toUpperCase().replace(/_/g, ' '),
  };
}

export function JobOrderStatusBadge({
  status,
  size = 'sm',
  variant = 'badge',
  style,
}: JobOrderStatusBadgeProps) {
  const { bg, text, border, label } = getJobOrderStatusStyle(status);

  if (variant === 'text') {
    return (
      <span
        style={{
          display: 'inline-block',
          color: text,
          fontSize: size === 'md' ? '13px' : '12px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
          lineHeight: 1.4,
          ...style,
        }}
      >
        {label}
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
        borderRadius: variant === 'pill' ? '9999px' : '12px',
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
      {label}
    </span>
  );
}
