import React from 'react';

interface PurchaseOrderStatusBadgeProps {
  status?: string | null;
  size?: 'sm' | 'md';
  variant?: 'badge' | 'text';
  style?: React.CSSProperties;
}

function getPurchaseOrderStatusStyle(status?: string | null) {
  const norm = (status || 'draft').toLowerCase().trim();

  if (norm === 'pending approval' || norm === 'pending_approval' || norm === 'pending') {
    return {
      bg: '#fff7ed',
      text: '#ea580c', // Bright orange matching Screenshot 2
      border: '#fed7aa',
      label: 'PENDING APPROVAL',
    };
  }

  if (norm === 'issued' || norm === 'open') {
    return {
      bg: '#f0f7fd',
      text: '#0284c7', // Sky blue matching Screenshot 3
      border: 'rgba(2, 132, 199, 0.25)',
      label: 'ISSUED',
    };
  }

  if (norm === 'approved' || norm === 'confirmed') {
    return {
      bg: '#eff6ff',
      text: '#2563eb', // Blue/indigo
      border: '#bfdbfe',
      label: 'APPROVED',
    };
  }

  if (norm === 'billed' || norm === 'closed' || norm === 'completed' || norm === 'received') {
    return {
      bg: '#ecfdf5',
      text: '#059669', // Emerald green
      border: '#a7f3d0',
      label: norm.toUpperCase(),
    };
  }

  if (norm === 'partially billed' || norm === 'partially received') {
    return {
      bg: '#fffbeb',
      text: '#d97706', // Amber
      border: '#fde68a',
      label: norm.toUpperCase(),
    };
  }

  if (norm === 'cancelled' || norm === 'void') {
    return {
      bg: '#fff1f2',
      text: '#dc2626', // Red
      border: '#fecdd3',
      label: norm.toUpperCase(),
    };
  }

  // Default: Draft
  return {
    bg: '#f1f5f9',
    text: '#64748b', // Grey/Slate matching Screenshot 1
    border: '#e2e8f0',
    label: 'DRAFT',
  };
}

export function PurchaseOrderStatusBadge({
  status,
  size = 'sm',
  variant = 'badge',
  style,
}: PurchaseOrderStatusBadgeProps) {
  const { bg, text, border, label } = getPurchaseOrderStatusStyle(status);
  const displayLabel = status ? status.toUpperCase() : label;

  if (variant === 'text') {
    return (
      <span
        style={{
          display: 'inline-block',
          color: text,
          fontSize: '12px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.02em',
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
        borderRadius: '12px',
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
